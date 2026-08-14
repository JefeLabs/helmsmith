import { Navigate, Route, Routes } from 'react-router-dom';
import NavShell from './components/NavShell';
import BenchmarkRunPage from './pages/BenchmarkRun';
import BenchmarksPage from './pages/Benchmarks';
import CatalogPage from './pages/Catalog';
import ComposePage from './pages/Compose';
import IntakePage from './pages/Intake';
import JobsPage from './pages/Jobs';
import ProposalsPage from './pages/Proposals';
import SessionsPage from './pages/Sessions';
import SubmitJobPage from './pages/SubmitJob';

export default function App() {
  return (
    <NavShell>
      <Routes>
        <Route path="/" element={<Navigate to="/intake" replace />} />
        <Route path="/intake" element={<IntakePage />} />
        <Route path="/intake/:sessionId" element={<IntakePage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/new" element={<SubmitJobPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/benchmarks" element={<BenchmarksPage />} />
        <Route path="/benchmarks/:runId" element={<BenchmarkRunPage />} />
        <Route path="/proposals" element={<ProposalsPage />} />
        <Route path="/compose" element={<ComposePage />} />
      </Routes>
    </NavShell>
  );
}
