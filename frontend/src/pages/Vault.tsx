import { useState } from "react"
import { gql } from "@apollo/client"
import { useQuery } from "@apollo/client/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, BookOpen, Calendar } from "lucide-react"

const NOTES_QUERY = gql`
  query Notes {
    notes(sort: "updatedAt:desc", pagination: { limit: 100 }) {
      documentId
      content
      idea {
        documentId
        title
      }
      createdAt
      updatedAt
    }
  }
`

interface VaultNote {
  documentId: string
  content: string
  idea?: { documentId: string; title: string }
  createdAt: string
  updatedAt: string
}

export default function Vault() {
  const { data, loading } = useQuery<{ notes: VaultNote[] }>(NOTES_QUERY)
  const [search, setSearch] = useState("")

  const notes: VaultNote[] = (data?.notes ?? []).filter(
    (note: VaultNote) =>
      search === "" ||
      note.content.toLowerCase().includes(search.toLowerCase()) ||
      note.idea?.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="h-6 w-6" />
          Knowledge Vault
        </h1>
        <p className="text-muted-foreground">All your notes in one place</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : notes.length === 0 ? (
        <Card>
          <CardContent className="flex h-32 items-center justify-center">
            <p className="text-muted-foreground">
              {search ? "No notes match your search" : "No notes yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <Card key={note.documentId} className="transition-colors hover:bg-accent/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  {note.idea ? (
                    <CardTitle className="text-sm font-medium truncate">
                      {note.idea.title}
                    </CardTitle>
                  ) : (
                    <CardTitle className="text-sm text-muted-foreground italic">
                      Unlinked Note
                    </CardTitle>
                  )}
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    note
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                  {note.content}
                </p>
                <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {new Date(note.updatedAt ?? note.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
