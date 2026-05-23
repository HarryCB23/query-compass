import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

export function UserMenu() {
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2 text-muted-foreground">
      <LogOut className="w-4 h-4" />
      Sign out
    </Button>
  )
}
