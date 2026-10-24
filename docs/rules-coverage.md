# Rules coverage and current limits

Rivet tracks characters for **5e 2014, 5e 2024, and 3.5e**. A searchable rules catalogue is not complete mechanics automation. Review your sheet with your DM.

## Reference library

`public/rules/` contains source-attributed rules packs and original source documents. The desktop build indexes them into `dist-electron/rules.sqlite`, with edition and category filtering, source IDs, and full-text search. Included material covers SRD 5.1, SRD 5.2.1, and the archived 3.5e SRD Open Game Content: spells, equipment, class and species/race options, backgrounds, feats, and reference sections.

The local search and source reader work offline without ChatGPT. Oracle can use the same read-only MCP catalogue, but generated answers still require checking against their cited source and your table's rulings.

## Implemented tracking

| Area | Current behavior | Limits |
| --- | --- | --- |
| Character identity | Separate edition schemas; editable species, classes, levels, abilities, skills, saves, feats and features | Full guided creation and advancement are not implemented; related progression values are not automatically derived |
| HP and state | Damage, healing, temporary HP, death saves, conditions, inspiration and exhaustion | Not every resistance, effect, or 3.5e dying/nonlethal interaction is automated |
| Resources and rests | Tracked capacities, spent uses, recovery rules, hit dice, fifth-edition rest recovery | Table-resolved healing and some multiclass choices require explicit input; daily/manual resources stay manual |
| Spellcasting | Bundled spell references, preparation, slots, fifth-edition slot/concentration updates | Complete class-specific/pact/multiclass pools, preparation limits, components and spell effects remain incomplete |
| Equipment | Catalogue, inventory, equipped slots, armour and weapon calculations, carrying calculations, currency | Not every equipment effect, interaction or 3.5e slot rule is automated |
| Calculations | Inspectable terms, tracked effects and explicit overrides | Full stacking, prerequisites and source-specific eligibility are incomplete |
| Oracle edits | Bounded commands with revision checks, routine Undo receipts, review for other changes | Oracle is not a legal-build validator; omitted dependent progression may need manual review |
| Rules authority | Edition-specific references and source citations | Your DM adjudicates outcomes; generated explanations can be wrong |

There is no dice roller or dice history. Enter damage, healing, and other resolved outcomes from your table.

## Platforms

The release focus is macOS. Apple Silicon has local build/package verification. Intel macOS, Windows, and Linux contain varying implementation support but are not yet verified release targets. The oldest usable macOS version has not been established by testing.

## Licensing

Application code is MIT licensed. SRD 5.1 and SRD 5.2.1 material is CC BY 4.0; 3.5e Open Game Content uses OGL 1.0a. Keep source IDs, hashes, attribution, and notices with redistributed rules packs. See [third-party notices](../THIRD_PARTY_NOTICES.md) and the notices in `public/rules/`.
