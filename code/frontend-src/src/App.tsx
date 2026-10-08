import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>AITC 2026 - Xoai Cheese</CardTitle>
          <CardDescription>
            React + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </CardContent>
        <CardFooter className="text-muted-foreground text-sm">
          Edit <code>src/App.tsx</code> to start building.
        </CardFooter>
      </Card>
    </main>
  )
}

export default App
