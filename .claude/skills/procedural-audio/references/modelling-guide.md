# Modelling guide

A model answers three questions: what excites the sound, what resonates, and
what happens next. Work out each before choosing parameters, and keep the
answers as the model's docstring so the next change keeps its physics.

## Recipes

| Sound | Exciter | Resonator | What follows |
| --- | --- | --- | --- |
| Knock, hit on wood | Contact 0.2 ms (blade edge) to 3 ms (knuckle) | Plank or door modes, 90 Hz to 3 kHz, decays 10-120 ms | A low thud as the panel moves in its frame |
| Metal clang, blade ring | Contact 0.1-0.5 ms | Inharmonic modes (ratios such as 1, 2.25, 3.3, 4.7), decays 0.1-0.5 s; a held blade decays faster | Scrape (noise 2-9 kHz, 10-50 ms) |
| Stone, brick | Contact 0.5-2 ms with roughness | Few high, short modes (1-6 kHz, under 15 ms): stone is stiff and heavy | Grit grains falling, 0.1-0.4 s |
| Footstep | Heel 8-12 ms (soft sole), toe 70-100 ms later at half strength | The ground: floorboard modes, stone clicks, or none | Gravel: dense grains 1-7 kHz; wood: an occasional creak |
| Body or sack drop | Contact 12-20 ms | Floor modes 75-1000 Hz | Contents shifting (grains 300-2500 Hz), a rock and settle |
| Breaking wood | One strong contact, then a fracture run (30-60 micro-failures in 0.1 s) | Plank modes | Boards falling with `rebounds` (restitution 0.4-0.5), splinters |
| Breaking glass | Hard contact 0.3 ms | Pane modes 0.6-7 kHz | 15-20 shards: high, glassy, short rings, bouncing, over 0.6 s |
| Swing, throw | Air past an edge | A band-pass whose centre follows speed: 200-400 Hz up to 1.3-2.5 kHz | A faint whistle for thin edges; low push for heavy heads |
| Creak | Stick-slip at 30-300 slips per second following the motion | Hinge and wood modes 0.6-3.5 kHz, 4-12 ms | The door settling |
| Lock, latch | Tiny metal contacts | Small, high iron modes | Bolt thunk 170-200 Hz, a faint spring ring |
| Coins | Disc-on-disc contact 0.2 ms | Inharmonic modes 4-12 kHz, decays 0.1-0.35 s | Several clinks 50-110 ms apart |
| Drip | A tiny splash | A bubble: 3260 / radius (mm) Hz, rising in pitch, 10-40 ms | Sometimes a second, smaller drop |
| Fire (loop) | Turbulent hot gas | Low roar under 300 Hz, slow swells | Crackle grains about 20 per second; pops of sap every second or two |
| Rain (loop) | Countless drops | Wash of noise 0.5-7 kHz per side | Nearer drops: clicks and bubbles panned across the field |

## Making it real rather than synthetic

- **Irregularity:** jitter every time, size and level a little; give each mode
  a random polarity (`impact` does); give crackle power-law levels so a few
  clicks stand out.
- **Coupling:** one contact excites everything it touches. A blade and the
  wood it hits share the contact time; do not give the blade a harder one.
- **Body:** most hits need a low component (`low_body`) for weight, but a loud low
  thud eats true-peak headroom while K-weighting discounts it. Keep it as
  quiet as still reads as weight.
- **Highs:** `polish` rolls off above 13 kHz for a warm, grounded style; raise
  it for glass and coins.
- **Takes:** three to six per frequent event. Check that they differ in
  timing and colour, not only in level.

## Fixes by symptom

| Symptom (sheet or numbers) | Cause | Fix |
| --- | --- | --- |
| Thin vertical line where a tail stops | A ring cut off by its buffer | Lengthen the buffer; `ring` and `exp_decay` already taper their last 10 ms |
| Short of target "at the ceiling" | High peak for its loudness: a hard contact or a big low thud | Longer contact, quieter thud, more sustained layer (debris, rustle), or a lower target |
| Dull, boxy | Contact too long for the material | Shorten the contact; add a click layer |
| Clicky, harsh | Contact too short, too many high modes | Lengthen the contact; shorten high-mode decays; lower `polish` high |
| Sounds like a sine tone | Too few modes, too regular | More modes, `individual` spread 0.04-0.1, noise layers |
| Loop pumps or jumps | Crossfade too short or textures not steady | Overlap 1-2 s in `blend_loop`; place events with `fold_loop`; check the seam numbers |
| Several sounds reported in one take | Gaps over 150 ms between parts | Fine for sequences (a lock); otherwise tighten the timing |
