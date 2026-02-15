import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import Settings from "./pages/Settings";
import Collections from "./pages/Collections";
import CollectionDetail from "./pages/CollectionDetail";

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="sidebar-title">Tinkerbell</h1>
        <nav>
          <NavLink to="/collections" className="nav-link">
            Collections
          </NavLink>
          <NavLink to="/settings" className="nav-link">
            Settings
          </NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/:ratingKey" element={<CollectionDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/collections" replace />} />
        </Routes>
      </main>
    </div>
  );
}
