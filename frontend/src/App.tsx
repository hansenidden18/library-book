import { Routes, Route } from "react-router-dom";
import AppShell from "./components/common/AppShell";
import LibraryPage from "./pages/LibraryPage";
import ReaderPage from "./pages/ReaderPage";
import StatsPage from "./pages/StatsPage";
import ShelvesPage from "./pages/ShelvesPage";
import NotebookPage from "./pages/NotebookPage";
import UploadPage from "./pages/UploadPage";
import DocumentDetailPage from "./pages/DocumentDetailPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      {/* Reader is full-screen, outside the shell */}
      <Route path="/read/:id" element={<ReaderPage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/papers" element={<LibraryPage docType="paper" />} />
        <Route path="/books" element={<LibraryPage docType="book" />} />
        <Route path="/shelf/:shelfId" element={<LibraryPage />} />
        <Route path="/document/:id" element={<DocumentDetailPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/notebook" element={<NotebookPage />} />
        <Route path="/shelves" element={<ShelvesPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
