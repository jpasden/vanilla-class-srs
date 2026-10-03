-- Repair missing memberships for existing active classes. This only adds
-- organizational links; no card or student data is modified.
INSERT INTO "TeacherSubjectGrade" ("teacherId", "subjectGradeId")
SELECT DISTINCT "teacherId", "subjectGradeId"
FROM "Class"
WHERE "archivedAt" IS NULL
ON CONFLICT ("teacherId", "subjectGradeId") DO NOTHING;
