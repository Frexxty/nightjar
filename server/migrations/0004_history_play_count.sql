-- How many times the account played each track. Recommendations seed from the
-- most-played tracks (src/recommendations.ts). Existing rows count as one play.
ALTER TABLE history ADD COLUMN play_count INTEGER NOT NULL DEFAULT 1;
