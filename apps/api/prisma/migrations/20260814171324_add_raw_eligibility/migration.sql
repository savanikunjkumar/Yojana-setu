-- Adds the source eligibility prose alongside the structured rule.
--
-- `eligibility` is a lossy interpretation of prose written by a ministry, and for
-- scraped rows that interpretation is made by an LLM. Keeping the original text
-- means a suspicious rule can be checked against what the portal actually said,
-- which is the difference between fixing a bad rule and fixing a bad reading of a
-- correct one. Nullable because hand-authored seed rows have no source prose.
--
-- Additive and nullable, so it is safe on a populated table.
ALTER TABLE "schemes" ADD COLUMN "raw_eligibility" TEXT;
