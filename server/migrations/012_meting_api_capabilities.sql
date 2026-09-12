ALTER TABLE "MetingApi"
  ADD COLUMN "capabilities" TEXT NOT NULL DEFAULT '["search","metadata","download"]';
