import { Outlet, Link } from "react-router-dom";

function Layout() {
  return (
    <div>
      <nav>
        <Link to="/">Home</Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;