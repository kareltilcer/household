# Reference data

Global reference content, versioned with the code and loaded by the server without a code
change ([D-61](../docs/prd/09-decisions.md), [D-70](../docs/prd/09-decisions.md)): country
profiles, units, and each module's categories, templates, presets and catalogs.

Every record carries a `source` for each field and a value per language, and is validated
against a JSON Schema in CI (PL-10). Content drafted without an expert is flagged for
review.

Empty until plan item 7 adds the pipeline and the country profiles. The crop catalog
(items 22 and 54) and each module's own sets follow.
