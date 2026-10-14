ALTER TABLE "CardSet" ADD COLUMN "copiedFromId" TEXT;
CREATE UNIQUE INDEX "CardSet_copiedFromId_subjectGradeId_key" ON "CardSet"("copiedFromId", "subjectGradeId");
ALTER TABLE "CardSet" ADD CONSTRAINT "CardSet_copiedFromId_fkey" FOREIGN KEY ("copiedFromId") REFERENCES "CardSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
