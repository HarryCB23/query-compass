import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { ArrowLeft, Save } from 'lucide-react'
import { UserMenu } from '@/components/UserMenu'
import { SERP_LOCATIONS } from '@/lib/serpLocations'
import type { Tables } from '@/integrations/supabase/types'

type Project = Tables<'projects'>

export default function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [project, setProject]                   = useState<Project | null>(null)
  const [clientName, setClientName]             = useState('')
  const [domain, setDomain]                     = useState('')
  const [brandedTermsRaw, setBrandedTermsRaw]   = useState('')
  const [altDomainsRaw, setAltDomainsRaw]       = useState('')
  const [defaultLocationCode, setDefaultLocationCode] = useState<number>(2826)
  const [dailySerpBudget, setDailySerpBudget]   = useState<string>('')
  const [loading, setLoading]                   = useState(true)
  const [saving, setSaving]                     = useState(false)

  useEffect(() => {
    if (!projectId) return
    supabase.from('projects').select('*').eq('id', projectId).single().then(({ data }) => {
      if (data) {
        setProject(data)
        setClientName(data.client_name)
        setDomain(data.domain)
        setBrandedTermsRaw(data.branded_terms.join(', '))
        setAltDomainsRaw((data.alt_domains ?? []).join(', '))
        setDefaultLocationCode(data.default_location_code ?? 2826)
        setDailySerpBudget(data.daily_serp_budget != null ? String(data.daily_serp_budget) : '')
      }
      setLoading(false)
    })
  }, [projectId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) return
    setSaving(true)
    const brandedTerms = brandedTermsRaw.split(',').map(t => t.trim()).filter(Boolean)
    const altDomains   = altDomainsRaw.split(',').map(t => t.trim()).filter(Boolean)
    const budget = dailySerpBudget.trim() !== '' ? parseFloat(dailySerpBudget) : null
    const { error } = await supabase
      .from('projects')
      .update({
        client_name: clientName.trim(),
        domain: domain.trim(),
        branded_terms: brandedTerms,
        alt_domains: altDomains,
        default_location_code: defaultLocationCode,
        daily_serp_budget: budget,
      })
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

          <div className="space-y-1.5">
            <Label htmlFor="alt-domains">Alt domains (comma-separated)</Label>
            <Input
              id="alt-domains"
              value={altDomainsRaw}
              onChange={e => setAltDomainsRaw(e.target.value)}
              placeholder="m.example.com, amp.example.com"
            />
            <p className="text-xs text-muted-foreground">
              Additional domains counted as "publisher" in SERP analysis (e.g. mobile, AMP).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="default-location">Default SERP location</Label>
            <Select
              value={String(defaultLocationCode)}
              onValueChange={v => setDefaultLocationCode(Number(v))}
            >
              <SelectTrigger id="default-location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERP_LOCATIONS.map(loc => (
                  <SelectItem key={loc.code} value={String(loc.code)}>
                    {loc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pre-selected when you open the Enrich SERP modal.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="daily-budget">Daily SERP budget (USD, optional)</Label>
            <Input
              id="daily-budget"
              type="number"
              min="0"
              step="0.01"
              value={dailySerpBudget}
              onChange={e => setDailySerpBudget(e.target.value)}
              placeholder="e.g. 5.00"
            />
            <p className="text-xs text-muted-foreground">
              Soft cap shown in the Enrich modal. No hard enforcement yet.
            </p>
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
