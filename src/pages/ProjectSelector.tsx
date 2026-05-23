import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog'
import { Search, Plus, FolderOpen } from 'lucide-react'
import type { Tables } from '@/integrations/supabase/types'

type Project = Tables<'projects'>

export default function ProjectSelector() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const navigate = useNavigate()

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setProjects(data)
    setLoading(false)
  }

  useEffect(() => { loadProjects() }, [])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <Search className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Query Compass</h1>
              <p className="text-sm text-muted-foreground">Traffic-risk reviews</p>
            </div>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New project
          </Button>
        </div>
      </header>

      <main className="container py-10">
        {loading ? (
          <p className="text-muted-foreground text-center py-20">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="max-w-md mx-auto text-center py-20 space-y-4">
            <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">No projects yet</h2>
            <p className="text-muted-foreground text-sm">
              Create your first project to start uploading GSC exports.
            </p>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              New project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => navigate(`/projects/${p.id}`)}
                className="text-left p-5 bg-card border rounded-xl hover:border-primary/50 hover:shadow-sm transition-all space-y-1"
              >
                <p className="font-semibold text-foreground">{p.client_name}</p>
                <p className="text-sm text-muted-foreground">{p.domain}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Created {new Date(p.created_at).toLocaleDateString()}
                </p>
              </button>
            ))}
          </div>
        )}
      </main>

      <CreateProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={loadProjects}
      />
    </div>
  )
}
