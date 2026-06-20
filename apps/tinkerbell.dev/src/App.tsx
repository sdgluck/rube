import { Routes, Route } from "react-router-dom";
import Nav from "#components/Nav";
import Footer from "#components/Footer";
import Home from "#pages/Home";
import Features from "#pages/Features";
import Screenshots from "#pages/Screenshots";

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/features" element={<Features />} />
          <Route path="/screenshots" element={<Screenshots />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
