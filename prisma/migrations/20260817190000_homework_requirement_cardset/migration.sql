-- CreateTable
CREATE TABLE "HomeworkRequirementCardSet" (
    "id" TEXT NOT NULL,
    "homeworkRequirementId" TEXT NOT NULL,
    "cardSetId" TEXT NOT NULL,

    CONSTRAINT "HomeworkRequirementCardSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkRequirementCardSet_homeworkRequirementId_cardSetI_key" ON "HomeworkRequirementCardSet"("homeworkRequirementId", "cardSetId");

-- AddForeignKey
ALTER TABLE "HomeworkRequirementCardSet" ADD CONSTRAINT "HomeworkRequirementCardSet_homeworkRequirementId_fkey" FOREIGN KEY ("homeworkRequirementId") REFERENCES "HomeworkRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkRequirementCardSet" ADD CONSTRAINT "HomeworkRequirementCardSet_cardSetId_fkey" FOREIGN KEY ("cardSetId") REFERENCES "CardSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
