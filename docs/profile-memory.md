# Profile memory

Haggle's profile is an anonymous browser profile, not an account. The browser creates a
32-character lowercase hexadecimal id and stores it in local storage. Requests to the profile
memory endpoints and Copilot runs use that id. Haggle does not ask for a name, email address, or
sign-in.

## What is remembered

When a Copilot negotiation finishes, Haggle can store its item title, category, asking price, final
price when there is one, outcome, and number of rounds. Practice runs are not remembered. Your
limit or budget is never stored in profile memory.

Past negotiations appear on the Profile page. Only successful deals with a final price are offered
as similar past deals. Similarity is based on overlapping wording from the item title and category,
not on semantic meaning; a matching result is not a market valuation or a promise that the items
are equivalent.

For an active Copilot run, the agent can receive short, code-built private notes with prior final
prices and discount percentages. The notes omit item titles and seller text. They are marked
private and intended for tone and realism only; the memory feature does not set the asking price,
the buyer's limit, or the offer prices. A validator rejects drafts that repeat a remembered final
price. The notes are shown on the Item tab with a reminder that they are never shared with the
seller.

## Preferences

You can save a default agent style, a preferred pickup-time window, and a usual pickup area. A
saved style preselects the Home form until you change it during that visit. Pickup-time preferences
put matching available slots first. Your pickup area is displayed to you as a reminder; it is not
sent to the AI. These preferences do not change the deal's prices.

## Manage and clear memory

Use **Forget** on a past negotiation to remove that record. **Clear my memory** removes the
profile's remembered deals and preferences. These actions affect only the profile id currently
stored by this browser.

Clearing browser storage removes the saved profile id. On the next visit Haggle creates a new id,
so the new profile starts empty. Existing database rows remain associated with the previous id;
they are not visible to, or cleared by, the new profile. To clear those rows from the Profile page,
keep the original id available until you use **Clear my memory**.

## Limits

- Memory is scoped to the anonymous id in this browser; it is not shared across browsers or devices.
- A lost browser id cannot be recovered through an account or identity service.
- Similarity is wording-based hashing, not a semantic search or an external market lookup.
- Only finished Copilot runs are recorded; only deals with a final price are candidates for the
  Similar past deals card and private notes.
- Memory is optional context. It does not guarantee a better negotiation or change the price
  rules.
- Haggle's pickup calendar is its own availability system. A saved time preference changes the
  order of suggested slots; it does not sync another calendar or confirm seller agreement.
