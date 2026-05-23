import { useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const [clientName, setClientName] = useState('')
  const [domain, setDomain] = useState('')
  const [brandedTermsRaw, setBrandedTermsRaw] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientName.trim() || !domain.trim()) return

    setSaving(true)
    try {
      // Resolve the user's org
      const { data: memberships, error: memErr } = await supabase
        .from('memberships')
        .select('org_id')
        .limit(1)
        .single()

      if (memErr || !memberships) {
        toast.error('Could not resolve your organisation')
        return
      }

      const brandedTerms = brandedTermsRaw
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)

      const { error } = await supabase.from('projects').insert({
        org_id: memberships.org_id,
        client_name: clientName.trim(),
        domain: domain.trim(),
        branded_terms: brandedTerms,
      })

      if (error) {
        toast.error('Failed to create project: ' + error.message)
        return
      }

      toast.success('Project created')
      setClientName('')
      setDomain('')
      setBrandedTermsRaw('')
      onOpenChange(false)
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Client name</Label>
            <Input
              id="client-name"
              placeholder="Acme Corp"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              placeholder="acme.com"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branded-terms">Branded terms (comma-separated)</Label>
            <Input
              id="branded-terms"
              placeholder="acme, acmecorp"
              value={brandedTermsRaw}
              onChange={e => setBrandedTermsRaw(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !clientName.trim() || !domain.trim()}>
              {saving ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
