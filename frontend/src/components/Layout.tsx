import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";

function Layout() {
  const { user, logout } = useAuth();

  return (
    <div>
      <nav>
        <Link to="/">Home</Link>
        {" | "}
        <Link to="/challenges">Challenges</Link>
        {user ? (
          <>
            {" | "}
            <Link to="/challenges/new">Create challenge</Link>
            {" | "}
            <span>
              Logged in as <strong>{user.username}</strong>{" "}
              <button type="button" onClick={logout}>
                Log out
              </button>
            </span>
          </>
        ) : (
          <>
            {" | "}
            <Link to="/login">Log in</Link>
            {" | "}
            <Link to="/register">Register</Link>
          </>
        )}
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;