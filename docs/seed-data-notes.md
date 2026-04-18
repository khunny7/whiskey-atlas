# Starter Seed Notes

This repository now has two concrete planning artifacts:

- `prisma/schema.prisma`: normalized schema for catalog, filtering, graph relationships, and recommendation scoring.
- `data/whiskeys.seed.json`: researched starter dataset for 50 bottles.

## What this seed is optimized for

- Fast MVP progress
- Traceable public-source provenance
- Enough structured fields to start filters and simple recommendations
- Conservative handling of fields that were not verified during this pass

## Source strategy used

1. MSRP reference
   - `https://www.thisblogsneat.com/whiskey-msrp`
2. Mash bill reference
   - `https://bourbon-whiskey-and-rye.com/whiskey-and-bourbon-mash-bills/`
3. Official producer pages where available during this pass
   - Buffalo Trace Bourbon
   - Eagle Rare 10
   - Blanton's family page
   - Wild Turkey 101
   - Wild Turkey Rare Breed
   - Wild Turkey Kentucky Spirit

## Important caveats

1. `msrpUsd` is a reference value, not a live retail price.
2. `proof` is only filled when verified in this pass or directly implied by a legally defined label such as Bottled in Bond.
3. `mashBillText` is stored as a seed-stage text field. A later import step should normalize repeated mash bills into a separate table or lookup.
4. `companyName` and `distilleryName` are usable for MVP seeding, but they still need a consolidation pass for parent-company hierarchy.
5. Flavor tags are sparse by design. Only a few bottles currently have tags sourced from official tasting pages. The recommendation system should treat missing flavor data as unknown, not neutral.

## Practical next step

The next implementation step should be a small importer that:

1. Reads `data/whiskeys.seed.json`
2. Upserts companies, distilleries, and whiskeys
3. Creates normalized flavor tags from `flavorTags`
4. Creates `SourceReference` rows from each bottle's `sourceKeys`

That gives you a running database without requiring the full 500-bottle cleanup pass first.