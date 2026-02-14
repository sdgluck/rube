import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="sidebar-title">Tinkerbell</h1>
        <nav>
          <NavLink to="/settings" className="nav-link">
            Settings
          </NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/settings" replace />} />
        </Routes>
      </main>
    </div>
  );
}
