import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";

function ProtectedRoute() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return <p>Loading…</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;