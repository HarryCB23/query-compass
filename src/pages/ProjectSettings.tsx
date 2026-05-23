import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { ArrowLeft, Save } from 'lucide-react'
import { UserMenu } from '@/components/UserMenu'
import type { Tables } from '@/integrations/supabase/types'

type Project = Tables<'projects'>

export default function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [project, setProject]           = useState<Project | null>(null)
  const [clientName, setClientName]     = useState('')
  const [domain, setDomain]             = useState('')
  const [brandedTermsRaw, setBrandedTermsRaw] = useState('')
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)

  useEffect(() => {
    if (!projectId) return
    supabase.from('projects').select('*').eq('id', projectId).single().then(({ data }) => {
      if (data) {
        setProject(data)
        setClientName(data.client_name)
        setDomain(data.domain)
        setBrandedTermsRaw(data.branded_terms.join(', '))
      }
      setLoading(false)
    })
  }, [projectId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) return
    setSaving(true)
    const brandedTerms = brandedTermsRaw.split(',').map(t => t.trim()).filter(Boolean)
    const { error } = await supabase
      .from('projects')
      .update({ client_name: clientName.trim(), domain: domain.trim(), branded_terms: brandedTerms })
      .eq('id', projectId)
    setSaving(false)
    if (error) { toast.error('Save failed: ' + error.message); return }
    toast.success('Settings saved')
    navigate(`/projects/${projectId}`)
  }

  if (loading) return <p className="text-muted-foreground text-center py-20">Loading…</p>
  if (!project) return <p className="text-destructive text-center py-20">Project not found</p>

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${projectId}`)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-lg font-bold text-foreground">Project settings</h1>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="container py-8 max-w-lg">
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Client name</Label>
            <Input
              id="client-name"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branded-terms">Branded terms (comma-separated)</Label>
            <Input
              id="branded-terms"
              value={brandedTermsRaw}
              onChange={e => setBrandedTermsRaw(e.target.value)}
              placeholder="acme, acmecorp"
            />
            <p className="text-xs text-muted-foreground">
              Used to classify queries as "branded" in analysis views.
            </p>
          </div>

          <div className="pt-2 p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">DataforSEO settings</p>
            <p>Location: {project.location_code} · Device: {project.device}</p>
            <p className="text-xs">Phase 4 will add editing for these fields.</p>
          </div>

          <Button type="submit" disabled={saving} className="gap-2 w-full">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </form>
      </main>
    </div>
  )
}
