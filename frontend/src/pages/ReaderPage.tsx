import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getDocument, getProgress } from "../api/client";
import PdfReader from "../components/reader/PdfReader";
import EpubReader from "../components/reader/EpubReader";

export default function ReaderPage() {
  const { id } = useParams();
  const docId = Number(id);

  const { data: doc } = useQuery({ queryKey: ["document", docId], queryFn: () => getDocument(docId) });
  const { data: progress, isLoading: progLoading } = useQuery({
    queryKey: ["progress", docId],
    queryFn: () => getProgress(docId),
  });

  if (!doc || progLoading) {
    return <div className="h-screen flex items-center justify-center text-slate-500">Loading...</div>;
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="h-12 shrink-0 border-b border-slate-800 flex items-center px-4 gap-3 bg-[#0e1117]">
        <Link to={`/document/${doc.id}`} className="text-slate-400 hover:text-white flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Back
        </Link>
        <span className="font-medium truncate">{doc.title}</span>
        <span className="ml-auto text-xs text-slate-500 uppercase">{doc.file_format}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        {doc.file_format === "pdf" ? (
          <PdfReader doc={doc} initialPage={progress?.pdf_page ?? 1} />
        ) : (
          <EpubReader doc={doc} initialCfi={progress?.epub_cfi ?? null} />
        )}
      </div>
    </div>
  );
}
