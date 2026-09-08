# Future — Meals, Recipes & Pantry

**Not in 1.0**, but the top of the post-1.0 list ([08-roadmap.md](../08-roadmap.md)), because it
completes the strongest cross-module story in the product:

```
meal plan → shopping list → pantry → garden harvest → meal plan
```

This page records the design far enough that 1.0's hooks are the right hooks.

## The hooks that already exist in 1.0

| Hook | Where | Purpose |
|---|---|---|
| `shopping_items.source_ref` | [modules/05-shopping.md](../modules/05-shopping.md) FR-SH2 | A generated item knows which recipe and which meal plan produced it, so regenerating a plan does not duplicate the list |
| Garden's harvest log and storage items | [modules/11-garden.md](../modules/11-garden.md) FR-GA14, FR-GA20 | Already shaped as `(product, quantity, unit, date, remaining)` — which is what a pantry row is |
| The crop catalog's `harvest_unit` and storage fields | Garden reference data | Gives a produce item its unit and shelf life without a second catalog |
| Document references | [D-40](../09-decisions.md) | A scanned family recipe is a document, not a new blob store |
| Finance categories | [modules/09-finance.md](../modules/09-finance.md) | Grocery spend is already categorised |

**Nothing in 1.0 needs to change to add this.** That is the test this page exists to satisfy.

## Sketch

### Recipes

Title, servings, ingredients (quantity, unit, item, optional note), method steps, prep and cook
time, tags, source, photos, and a per-household rating. Import from a URL by parsing embedded
recipe metadata where present, and from a photo — the latter being an AI feature and therefore
gated on [future/ai-assistant.md](ai-assistant.md).

**Ingredients reference a normalised item catalog** shared with Shopping's categories, which is what
makes "2 kg potatoes" in a recipe and "potatoes" on a shopping list and "potatoes" in the pantry the
same thing. Building that catalog is most of the work in this module and it should be designed once,
carefully.

### Meal plan

A calendar of meals per day per slot (breakfast, lunch, dinner, other), each referencing a recipe or
carrying free text. Scaling by servings adjusts ingredient quantities. Generating a shopping list
from a date range aggregates ingredients, **subtracts what the pantry already holds**, and creates
items carrying `source_ref`.

### Pantry

What the household has, where, and until when: item, quantity, unit, location (fridge, freezer,
cupboard, cellar), opened date, best-before, and a low-stock threshold. Decremented by cooking a
planned meal, incremented by shopping and by garden harvests.

**Expiry reminders** register with the reminder strand. **Low stock** offers items to a shopping
list rather than adding them silently.

### The Garden bridge

A garden harvest becomes a pantry item with one tap, carrying its unit and shelf life from the crop
catalog. Garden's `storage_items` — jars, dried, frozen — become a pantry location rather than a
parallel system, and the migration is a straight one because the shapes already match.

## The hard parts, recorded now

1. **The item catalog.** Ingredient names, units, densities (for volume-to-mass), and translations
   across five languages. It is the same class of content problem as the crop catalog, and the same
   answer applies: curated, versioned, with household additions.
2. **Unit conversion.** "2 cups of flour" versus "250 g" is a density lookup, and getting it wrong
   makes the shopping list nonsense. Mass and volume must not be silently interconverted without a
   density.
3. **Pantry decrement honesty.** Automatically decrementing on a planned meal assumes the meal was
   cooked as planned. It should be a confirmation, not an assumption — the same rule as Finance's
   recurring transactions ([modules/09-finance.md](../modules/09-finance.md) FR-FI22).
4. **Not becoming a nutrition app.** Calories, macros and dietary tracking are a different product
   with different regulatory exposure, and this module should say no to them explicitly.
