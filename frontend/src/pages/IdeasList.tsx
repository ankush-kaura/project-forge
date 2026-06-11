import { useState } from "react"
import { gql } from "@apollo/client"
import { useQuery } from "@apollo/client/react"
import { Link } from "react-router-dom"
import { IdeaCard } from "@/components/IdeaCard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Search,
  Plus,
  LayoutGrid,
  List,
} from "lucide-react"
import type { Idea } from "@/types"

const IDEAS_QUERY = gql`
  query Ideas {
    ideas(sort: "updatedAt:desc", pagination: { limit: 100 }) {
      documentId
      title
      description
      status
      tags
      category
      source
      analysis {
        viability_score
      }
      priority {
        final_score
        rank
      }
      createdAt
      updatedAt
    }
  }
`

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "captured", label: "Captured" },
  { value: "analyzing", label: "Analyzing" },
  { value: "analyzed", label: "Analyzed" },
  { value: "prioritized", label: "Prioritized" },
  { value: "building", label: "Building" },
  { value: "launched", label: "Launched" },
  { value: "archived", label: "Archived" },
]

export default function IdeasList() {
  const { data, loading } = useQuery<{ ideas: Idea[] }>(IDEAS_QUERY)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  const ideas: Idea[] = (data?.ideas ?? []).filter((idea: Idea) => {
    const matchesSearch =
      search === "" ||
      idea.title.toLowerCase().includes(search.toLowerCase()) ||
      idea.description.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = status === "all" || idea.status === status
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ideas</h1>
          <p className="text-muted-foreground">
            {loading ? "Loading..." : `${ideas.length} ideas`}
          </p>
        </div>
        <Link to="/ideas/new">
          <Button>
            <Plus className="h-4 w-4" />
            New Idea
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search ideas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors sm:w-44"
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="flex items-center rounded-md border">
          <button
            className={`p-1.5 ${viewMode === "grid" ? "bg-accent" : ""}`}
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            className={`p-1.5 ${viewMode === "list" ? "bg-accent" : ""}`}
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Ideas */}
      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : ideas.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No ideas found</p>
          <Link to="/ideas/new" className="mt-2 inline-block">
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4" />
              Create one
            </Button>
          </Link>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ideas.map((idea) => (
            <IdeaCard key={idea.documentId} idea={idea} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left text-sm font-medium">Title</th>
                <th className="p-3 text-left text-sm font-medium">Category</th>
                <th className="p-3 text-left text-sm font-medium">Status</th>
                <th className="p-3 text-left text-sm font-medium">Score</th>
                <th className="p-3 text-left text-sm font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((idea) => (
                <tr key={idea.documentId} className="border-b hover:bg-muted/50">
                  <td className="p-3">
                    <Link to={`/ideas/${idea.documentId}`} className="font-medium hover:underline">
                      {idea.title}
                    </Link>
                  </td>
                  <td className="p-3 text-sm text-muted-foreground capitalize">{idea.category}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-secondary">
                      {idea.status}
                    </span>
                  </td>
                  <td className="p-3 text-sm">
                    {idea.priority?.final_score ?? idea.analysis?.viability_score ?? "—"}
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">
                    {new Date(idea.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
