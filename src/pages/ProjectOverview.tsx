import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Upload, Settings, ArrowLeft, FileText, Loader2 } from 'lucide-react'
import type { Tables } from '@/integrations/supabase/types'

type Project = Tables<'projects'>
type Import  = Tables<'imports'>

const SOFT_ROW_LIMIT = 25_000

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [project, setProject]   = useState<Project | null>(null)
  const [imports, setImports]   = useState<Import[]>([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    if (!projectId) return
    setLoading(true)
    const [{ data: proj }, { data: imps }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('imports').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ])
    if (proj) setProject(proj)
    if (imps) setImports(imps)
    setLoading(false)
  }

  useEffect(() => { load() }, [projectId])

  async function ingestFile(file: File) {
    if (!projectId) return
    const text = await file.text()

    // Rough line count (soft advisory — we still send it)
    const lineCount = text.split('\n').length - 1
    if (lineCount > SOFT_ROW_LIMIT) {
      toast.warning(
        `This file has ~${lineCount.toLocaleString()} rows. Files over ${SOFT_ROW_LIMIT.toLocaleString()} rows may hit the 60 s edge-function timeout.`,
        { duration: 6000 }
      )
    }

    setUploading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toast.error('Not authenticated'); return }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-csv`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ project_id: projectId, csv_text: text, file_name: file.name }),
        }
      )

      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Upload failed')
        return
      }

      toast.success(`Imported ${json.row_count.toLocaleString()} rows`)
      if (json.errors?.length) {
        toast.warning(`${json.errors.length} rows skipped — see console`, { duration: 5000 })
        console.warn('ingest-csv parse errors', json.errors)
      }

      navigate(`/projects/${projectId}/imports/${json.import_id}`)
    } finally {
      setUploading(false)
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (!file.name.endsWith('.csv')) { toast.error('Please upload a CSV file'); return }
    ingestFile(file)
  }

  if (loading) return <p className="text-muted-foreground text-center py-20">Loading…</p>
  if (!project) return <p className="text-destructive text-center py-20">Project not found</p>

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold text-foreground">{project.client_name}</h1>
              <p className="text-xs text-muted-foreground">{project.domain}</p>
            </div>
          </div>
          <Link to={`/projects/${projectId}/settings`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </Button>
          </Link>
        </div>
      </header>

      <main className="container py-8 space-y-8">
        {/* Upload dropzone */}
        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Uploading and parsing…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Upload className="w-8 h-8" />
              <p className="text-sm font-medium">Drop a GSC CSV here, or click to browse</p>
              <p className="text-xs">Soft limit: {SOFT_ROW_LIMIT.toLocaleString()} rows</p>
            </div>
          )}
        </div>

        {/* Import history */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Import history
          </h2>
          {imports.length === 0 ? (
            <p className="text-muted-foreground text-sm py-6 text-center">No imports yet</p>
          ) : (
            <div className="space-y-2">
              {imports.map(imp => (
                <Link
                  key={imp.id}
                  to={`/projects/${projectId}/imports/${imp.id}`}
                  className="flex items-center gap-3 p-4 bg-card border rounded-lg hover:border-primary/50 transition-colors"
                >
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{imp.file_name ?? 'Unnamed'}</p>
                    <p className="text-xs text-muted-foreground">
                      {imp.row_count != null ? `${imp.row_count.toLocaleString()} rows · ` : ''}
                      {new Date(imp.created_at).toLocaleString()}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
