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
import AdminSubjectGradesPage from './pages/admin/SubjectGradesPage'
import AdminTeachersPage from './pages/admin/TeachersPage'
import AdminCardSetsPage from './pages/admin/CardSetsPage'

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
  if (role && user.role !== role) return <Navigate to="/" replace />
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
              <Route path="subject-grades" element={<AdminSubjectGradesPage />} />
              <Route path="teachers" element={<AdminTeachersPage />} />
              <Route path="cardsets" element={<AdminCardSetsPage />} />
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
