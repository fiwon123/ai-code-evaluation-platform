import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import Spinner from "./Spinner/Spinner.tsx";

function ProtectedRoute() {
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
        <Spinner size="lg" label="Checking authentication" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;