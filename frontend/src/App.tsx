import { Suspense, lazy } from "react"
import type { ReactNode } from "react"
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import { ApolloProvider } from "@apollo/client/react"
import { client } from "./graphql/client"
import { useAuth } from "./hooks/useAuth"
import { Layout } from "./components/Layout"

const Login = lazy(() => import("./pages/Login"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const IdeasList = lazy(() => import("./pages/IdeasList"))
const IdeaNew = lazy(() => import("./pages/IdeaNew"))
const IdeaDetail = lazy(() => import("./pages/IdeaDetail"))
const Brainstorm = lazy(() => import("./pages/Brainstorm"))
const Priority = lazy(() => import("./pages/Priority"))
const Vault = lazy(() => import("./pages/Vault"))
const Health = lazy(() => import("./pages/Health"))

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function App() {
  return (
    <ApolloProvider client={client}>
      <Router>
        <Suspense fallback={<div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">Loading…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="ideas" element={<IdeasList />} />
              <Route path="ideas/new" element={<IdeaNew />} />
              <Route path="ideas/:id" element={<IdeaDetail />} />
              <Route path="ideas/:id/brainstorm" element={<Brainstorm />} />
              <Route path="priorities" element={<Priority />} />
              <Route path="vault" element={<Vault />} />
              <Route path="health" element={<Health />} />
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </ApolloProvider>
  )
}

export default App
