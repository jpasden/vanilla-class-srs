import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './components/AuthProvider'
import { EnrollmentProvider } from './components/EnrollmentProvider'
import { useAuth } from './utils/auth'

// Auth pages
import LoginPage from './pages/auth/LoginPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'
import ChangePasswordPage from './pages/auth/ChangePasswordPage'

// Layouts
import AdminLayout from './pages/admin/AdminLayout'
import TeacherLayout from './pages/teacher/TeacherLayout'
import StudentLayout from './pages/student/StudentLayout'

// Admin pages
import AdminDepartmentsPage from './pages/admin/DepartmentsPage'
import AdminDepartmentSettingsPage from './pages/admin/DepartmentSettingsPage'
import AdminSubjectGradesPage from './pages/admin/SubjectGradesPage'
import AdminBatchOperationsPage from './pages/admin/BatchOperationsPage'
import AdminTeachersPage from './pages/admin/TeachersPage'
import AdminCardSetsPage from './pages/admin/CardSetsPage'
import AdminCardSetDetailPage from './pages/admin/CardSetDetailPage'
import AdminClassesPage from './pages/admin/ClassesPage'
import AdminClassDetailPage from './pages/admin/ClassDetailPage'
import AdminStatsPage from './pages/admin/StatsPage'
import AdminStudentAdditionsPage from './pages/admin/StudentAdditionsPage'

// Teacher pages
import TeacherClassesPage from './pages/teacher/ClassesPage'
import TeacherClassDetailPage from './pages/teacher/ClassDetailPage'
import TeacherStudentCardsPage from './pages/teacher/StudentCardsPage'
import TeacherCardSetsPage from './pages/teacher/CardSetsPage'
import TeacherCardSetDetailPage from './pages/teacher/CardSetDetailPage'
import TeacherStudentStatsPage from './pages/teacher/StudentStatsPage'

// Student pages
import EnrollmentPickerPage from './pages/student/EnrollmentPickerPage'
import StudentDeckPage from './pages/student/DeckPage'
import ReviewPage from './pages/student/ReviewPage'
import StudentStatsPage from './pages/student/StatsPage'
import OptionalSetsPage from './pages/student/OptionalSetsPage'

function RequireAuth({ children, role }: { children: JSX.Element; role?: string }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  // Admins can also act as teachers (mirrors the server's requireTeacher,
  // which allows ADMIN through) — an admin with a Teacher profile can use
  // /teacher/* alongside /admin/* under one login.
  const allowed = role === 'TEACHER' ? user.role === 'TEACHER' || user.role === 'ADMIN' : !role || user.role === role
  if (!allowed) return <Navigate to="/" replace />
  return children
}

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  if (user.role === 'ADMIN') return <Navigate to="/admin/departments" replace />
  if (user.role === 'TEACHER') return <Navigate to="/teacher/classes" replace />
  return <Navigate to="/student" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <EnrollmentProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />

            {/* Root redirect */}
            <Route path="/" element={<RootRedirect />} />

            {/* Admin */}
            <Route path="/admin" element={<RequireAuth role="ADMIN"><AdminLayout /></RequireAuth>}>
              <Route index element={<Navigate to="/admin/departments" replace />} />
              <Route path="departments" element={<AdminDepartmentsPage />} />
              <Route path="departments/:id/settings" element={<AdminDepartmentSettingsPage />} />
              <Route path="subject-grades" element={<AdminSubjectGradesPage />} />
              <Route path="subject-grades/:id/batch" element={<AdminBatchOperationsPage />} />
              <Route path="teachers" element={<AdminTeachersPage />} />
              <Route path="cardsets" element={<AdminCardSetsPage />} />
              <Route path="cardsets/:id" element={<AdminCardSetDetailPage />} />
              <Route path="classes" element={<AdminClassesPage />} />
              <Route path="classes/:id" element={<AdminClassDetailPage />} />
              <Route path="classes/:id/students/:studentId" element={<TeacherStudentCardsPage />} />
              <Route path="classes/:classId/students/:studentId/stats" element={<TeacherStudentStatsPage />} />
              <Route path="stats" element={<AdminStatsPage />} />
              <Route path="stats/student-additions" element={<AdminStudentAdditionsPage />} />
            </Route>

            {/* Teacher */}
            <Route path="/teacher" element={<RequireAuth role="TEACHER"><TeacherLayout /></RequireAuth>}>
              <Route index element={<Navigate to="/teacher/classes" replace />} />
              <Route path="classes" element={<TeacherClassesPage />} />
              <Route path="classes/:id" element={<TeacherClassDetailPage />} />
              <Route path="classes/:id/students/:studentId" element={<TeacherStudentCardsPage />} />
              <Route path="classes/:classId/students/:studentId/stats" element={<TeacherStudentStatsPage />} />
              <Route path="cardsets" element={<TeacherCardSetsPage />} />
              <Route path="cardsets/:id" element={<TeacherCardSetDetailPage />} />
            </Route>

            {/* Student */}
            <Route path="/student" element={<RequireAuth role="STUDENT"><StudentLayout /></RequireAuth>}>
              <Route index element={<EnrollmentPickerPage />} />
              <Route path="deck" element={<StudentDeckPage />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="stats" element={<StudentStatsPage />} />
              <Route path="optional" element={<OptionalSetsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </EnrollmentProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
