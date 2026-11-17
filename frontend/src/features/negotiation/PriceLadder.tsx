import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { buildPriceSeries, type PriceSeries } from "../../lib/series";
import type { TraceEntry } from "../../types";
import styles from "./priceLadder.module.css";

export interface PriceLadderProps {
  trace: TraceEntry[];
  asking: number;
  limit: number;
  dealPrice: number | null;
}

const PLOT_LEFT = 56;
const PLOT_RIGHT = 534;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 236;

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function axisLabel(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function xFor(round: number, maxRound: number): number {
  if (maxRound <= 1) return (PLOT_LEFT + PLOT_RIGHT) / 2;
  return PLOT_LEFT + ((round - 1) / (maxRound - 1)) * (PLOT_RIGHT - PLOT_LEFT);
}

function yFor(price: number, ymin: number, ymax: number): number {
  if (ymax === ymin) return (PLOT_TOP + PLOT_BOTTOM) / 2;
  return PLOT_BOTTOM - ((price - ymin) / (ymax - ymin)) * (PLOT_BOTTOM - PLOT_TOP);
}

function stepPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    d += ` L${curr.x},${prev.y} L${curr.x},${curr.y}`;
  }
  return d;
}

function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L${points[i].x},${points[i].y}`;
  }
  return d;
}

export function PriceLadder({ trace, asking, limit, dealPrice }: PriceLadderProps) {
  const series: PriceSeries = buildPriceSeries(trace, asking, limit, dealPrice);
  const svgRef = useRef<SVGSVGElement>(null);
  const sellerPathRef = useRef<SVGPathElement>(null);
  const offerPathRef = useRef<SVGPathElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const { ourOffers, sellerAsks } = series;
  const allPrices: number[] = [asking, limit, ...ourOffers.map((p) => p.price), ...sellerAsks.map((p) => p.price)];
  if (dealPrice != null) allPrices.push(dealPrice);
  const valid = allPrices.filter((p) => Number.isFinite(p));
  const hasData = ourOffers.length > 0 || sellerAsks.length > 0;

  let ymin = 0;
  let ymax = 0;
  if (valid.length > 0) {
    ymin = Math.min(...valid) * 0.95;
    ymax = Math.max(...valid) * 1.05;
    if (ymax === ymin) ymax = ymin * 1.05;
  }

  const maxRound = Math.max(
    ourOffers.length ? ourOffers[ourOffers.length - 1].round : 0,
    sellerAsks.length ? sellerAsks[sellerAsks.length - 1].round : 0,
  );

  const sellerPoints = sellerAsks.map((p) => ({ x: xFor(p.round, maxRound), y: yFor(p.price, ymin, ymax) }));
  const offerPoints = ourOffers.map((p) => ({ x: xFor(p.round, maxRound), y: yFor(p.price, ymin, ymax) }));

  const animate = useCallback((ref: RefObject<SVGPathElement>) => {
    const path = ref.current;
    if (!path || reduced) return;
    const length = path.getTotalLength();
    path.style.setProperty("stroke-dasharray", `${length} ${length}`);
    path.style.setProperty("stroke-dashoffset", `${length}`);
  }, [reduced]);

  useEffect(() => {
    if (!hasData || reduced) return;
    animate(sellerPathRef);
    animate(offerPathRef);
    const id = requestAnimationFrame(() => setDrawing(true));
    return () => cancelAnimationFrame(id);
  }, [hasData, reduced, animate]);

  // Y ticks: 5 values, rounded to nearest 25 (or finer for small ranges).
  const tickCount = 5;
  const range = ymax - ymin;
  const step = range > 100 ? 25 : range > 20 ? 5 : 1;
  const rawStep = (ymax - ymin) / (tickCount - 1);
  const ticks: number[] = [];
  for (let i = 0; i < tickCount; i += 1) {
    ticks.push(roundTo(ymin + rawStep * i, step));
  }
  const uniqTicks = [...new Set(ticks)].sort((a, b) => a - b);

  const ariaParts: string[] = [];
  ariaParts.push(`Price ladder: asking RM ${axisLabel(asking)}, limit RM ${axisLabel(limit)}.`);
  if (ourOffers.length) {
    ariaParts.push(`Our offers: ${ourOffers.map((p) => `Round ${p.round} RM ${axisLabel(p.price)}`).join(", ")}.`);
  }
  if (sellerAsks.length) {
    ariaParts.push(`Seller asks: ${sellerAsks.map((p) => `Round ${p.round} RM ${axisLabel(p.price)}`).join(", ")}.`);
  }
  if (dealPrice != null) {
    ariaParts.push(`Deal RM ${axisLabel(dealPrice)}.`);
  }
  const ariaLabel = ariaParts.join(" ");

  return (
    <div className={styles.ladder} role="img" aria-label={ariaLabel} data-testid="price-ladder">
      <div className={styles.chartHeader}>
        <span className={styles.axisTitle}>Price (RM)</span>
        <div className={styles.legend} role="list" aria-label="Chart legend">
          <span className={styles.legendItem} role="listitem">
            <span className={[styles.swatch, styles.askingSwatch].join(" ")} aria-hidden="true" />
            Asking RM {axisLabel(asking)}
          </span>
          <span className={styles.legendItem} role="listitem">
            <span className={[styles.swatch, styles.limitSwatch].join(" ")} aria-hidden="true" />
            Your limit RM {axisLabel(limit)}
          </span>
          {sellerAsks.length > 0 && (
            <span className={styles.legendItem} role="listitem">
              <span className={[styles.swatch, styles.sellerSwatch].join(" ")} aria-hidden="true" />
              Seller asks
            </span>
          )}
          {ourOffers.length > 0 && (
            <span className={styles.legendItem} role="listitem">
              <span className={[styles.swatch, styles.offerSwatch].join(" ")} aria-hidden="true" />
              Our offers
            </span>
          )}
          {dealPrice != null && (
            <span className={styles.legendItem} role="listitem">
              <span className={[styles.swatch, styles.dealSwatch].join(" ")} aria-hidden="true" />
              Deal RM {axisLabel(dealPrice)}
            </span>
          )}
        </div>
      </div>
      <svg ref={svgRef} className={styles.svg} viewBox={`0 0 590 264`} aria-hidden="true">
        {/* Gridlines */}
        {uniqTicks.map((tick) => {
          const y = yFor(tick, ymin, ymax);
          return (
            <line
              key={tick}
              className={styles.gridLine}
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={y}
              y2={y}
            />
          );
        })}
        {/* Reference lines */}
        {valid.length > 0 && (
          <>
            <line
              className={styles.askLine}
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={yFor(asking, ymin, ymax)}
              y2={yFor(asking, ymin, ymax)}
            />
            <line
              className={styles.limitLine}
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={yFor(limit, ymin, ymax)}
              y2={yFor(limit, ymin, ymax)}
            />
          </>
        )}
        {/* Y axis labels */}
        {uniqTicks.map((tick) => (
          <text key={tick} className={styles.axisY} x={PLOT_LEFT - 8} y={yFor(tick, ymin, ymax)}>
            {axisLabel(tick)}
          </text>
        ))}
        {/* Seller asks (stepped, seller colour) */}
        <path
          ref={sellerPathRef}
          className={[styles.sellerLine, drawing && styles.drawing].filter(Boolean).join(" ")}
          d={stepPath(sellerPoints)}
        />
        {/* Our offers (agent colour) */}
        <path
          ref={offerPathRef}
          className={[styles.offerLine, drawing && styles.drawing].filter(Boolean).join(" ")}
          d={linePath(offerPoints)}
        />
        {offerPoints.map((pt, i) => (
          <circle key={`offer-${i}`} className={styles.offerDot} cx={pt.x} cy={pt.y} r={3} />
        ))}
        {/* Deal marker */}
        {dealPrice != null && maxRound > 0 && (
          <circle
            className={styles.dealDot}
            cx={xFor(maxRound, maxRound)}
            cy={yFor(dealPrice, ymin, ymax)}
            r={5}
          />
        )}
        {/* X axis labels */}
        {ourOffers.length > 0 &&
          ourOffers.map((p) => (
            <text key={`x-${p.round}`} className={styles.axisX} x={xFor(p.round, maxRound)} y={PLOT_BOTTOM + 18}>
              {p.round}
            </text>
          ))}
      </svg>
      <table className={styles.dataTable} aria-label="Price ladder data">
        <caption>Price ladder</caption>
        <thead>
          <tr>
            <th>Round</th>
            <th>Our offer</th>
            <th>Seller ask</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRound }, (_, i) => {
            const round = i + 1;
            const our = ourOffers.find((p) => p.round === round);
            const seller = sellerAsks.find((p) => p.round === round);
            return (
              <tr key={round}>
                <td>{round}</td>
                <td>{our ? `RM ${axisLabel(our.price)}` : "—"}</td>
                <td>{seller ? `RM ${axisLabel(seller.price)}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
