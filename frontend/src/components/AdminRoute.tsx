import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import Spinner from "./Spinner/Spinner.tsx";

/**
 * Route guard for admin-only views. Requires an authenticated user with the
 * is_admin flag; everyone else is sent back to the home page.
 */
function AdminRoute() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "var(--space-12)",
        }}
      >
        <Spinner size="lg" label="Checking permissions" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export default AdminRoute;