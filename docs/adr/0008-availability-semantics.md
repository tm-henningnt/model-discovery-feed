# ADR 0008: Define availability as provider catalog membership

Status: Accepted

## Context

The feed publishes 1164 model offerings. Every collector writes the literal `availability.status: "available"`. No collector verifies that an offering answers an inference request.

The field carries no information. A downstream consumer reported four offerings that the feed called available and that their provider rejected at call time.

`last_checked_at` and `last_success_at` are always written to the same collector run timestamp. An unverified offering looks freshly verified.

Live inference probes are not possible. The project has a hard constraint of no credit spend for availability checks.

## Decision

- `availability.status` answers one question: can a consumer still buy this offering? `available` means the provider's own catalog currently lists the offering for sale. It is never a guarantee that a given consumer's credentials can call the model.

- Each collector run compares its offerings against the last published feed release. An offering that leaves the provider catalog stays in the feed as a tombstone. It does not disappear silently.

- Hysteresis is graded. An offering absent from one run gets status `unknown`. An offering absent from two or more consecutive runs gets status `retired`.

- Two independent guards protect against a collector failure that reads as a mass retirement. First, the diff is skipped for a provider whose collector reported a fetch failure; its offerings carry forward unchanged. Second, the diff is skipped and a notice is emitted when a provider loses more than 20 percent of its roster and at least 3 offerings in one run. Both conditions must hold.

- `last_checked_at` advances on every run, including a failed run. `last_success_at` advances only when the offering was observed in the provider catalog. A gap between the two timestamps shows that the row carries forward without a new observation. Consumers compute freshness from `last_success_at`.

- Status precedence — first-party evidence wins: (a) absent from the provider catalog gives `retired`, subject to the hysteresis in the point above; (b) a provider-published retirement date in the past gives `retired`, and a date in the future gives `deprecated`; (c) a models.dev `status` of `deprecated` gives `deprecated`, but only where the existing canonical model match is confident — never a fuzzy match; (d) otherwise `available`. The rule that fired is recorded in the offering's source claim.

- A `retired` offering stays in the feed until 7 days after its `last_success_at`. The window is wall-clock time, not a count of runs. The collector job runs daily at 03:17 UTC through GitHub Actions, but a scheduled workflow can be delayed or disabled.

- The retention window is an absolute cap on every carry-forward, including a carry-forward that a guard caused. No offering stays in the feed more than 7 days after its last successful observation. Without this cap a guard deadlocks: each run carries the roster forward, which recreates the baseline that tripped the guard, so the guard trips again forever and holds dead offerings at `available`. The cap makes both guards self-clearing and gives an operator 7 days of daily notices.

- An offering that an earlier stage removed on positive evidence of retirement does not count toward the mass-loss ratio, and it retires at once instead of waiting one run at `unknown`. A models.dev `deprecated` status is such evidence. This separates a deliberate removal from an unexplained disappearance. Without the exception, one evidence-backed bulk removal reads as a provider outage: dropping 7 of 23 OpenCode Go offerings is a 30 percent loss, which trips the mass-loss guard and republishes the dead offerings.

- A `retired` offering gets `policy.visibility: "hidden"`. It leaves search, facet counts, and profile ranking through the existing visibility gate. A lookup by offering id still resolves it, so a consumer can audit a pinned configuration.

- The `available=true` filter stays strict. It matches only status `available`.

- Availability is observed with the feed's own collector credentials. Providers can gate a model by account age, region, or plan tier. The feed cannot detect per-account gating without per-consumer probes. The published contract states this limitation.

## Rejected alternatives

### Reserve `available` for verified-callable offerings

Rejected because no free evidence of callability exists for most providers. The filter `available=true` would return zero offerings on the first day and stay useless.

### Add a `listed` enum value for catalog-only offerings

Rejected because it adds a value to a published schema. Every consumer must learn the value or mishandle it silently.

### Drop an offering silently when it leaves the catalog

Rejected because the status field then stays a constant. A consumer with a pinned model id gets no signal that the model is gone.

### Retain tombstones forever

Rejected because the feed grows without bound. Dead offerings also dilute the discovery surface.

### Count runs instead of wall-clock time for the retention window

Rejected because a stopped or delayed job freezes the counter. Tombstones would then never age out.

### Add an `observed_with` field to record the collector credentials

Rejected because the value is identical for all 1164 offerings today. The schema addition is not justified until a second observer exists.

## Consequences

- `availability.status` carries information for the first time. The `available=true` filter and the availability facet become useful.

- The retirement diff depends on the append-only `FeedRelease` history. The last published release must stay readable.

- A consumer that pins an offering id sees an explicit `retired` status for 7 days before the offering leaves the feed.

- The feed does not detect per-account gating. An offering can be `available` and still fail for a consumer whose account is newer than the collector account.
