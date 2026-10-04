-- CreateTable
CREATE TABLE "SubjectGradeLead" (
    "subjectGradeId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,

    CONSTRAINT "SubjectGradeLead_pkey" PRIMARY KEY ("subjectGradeId")
);

-- CreateIndex
CREATE INDEX "SubjectGradeLead_teacherId_idx" ON "SubjectGradeLead"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectGradeLead_teacherId_subjectGradeId_key" ON "SubjectGradeLead"("teacherId", "subjectGradeId");

-- AddForeignKey
ALTER TABLE "SubjectGradeLead" ADD CONSTRAINT "SubjectGradeLead_subjectGradeId_fkey" FOREIGN KEY ("subjectGradeId") REFERENCES "SubjectGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectGradeLead" ADD CONSTRAINT "SubjectGradeLead_teacherId_subjectGradeId_fkey" FOREIGN KEY ("teacherId", "subjectGradeId") REFERENCES "TeacherSubjectGrade"("teacherId", "subjectGradeId") ON DELETE RESTRICT ON UPDATE CASCADE;
