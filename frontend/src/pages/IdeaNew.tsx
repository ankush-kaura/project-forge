import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { gql } from "@apollo/client"
import { useMutation } from "@apollo/client/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Save, X } from "lucide-react"

const CREATE_IDEA = gql`
  mutation CreateIdea($data: IdeaInput!) {
    createIdea(data: $data) {
      documentId
      title
    }
  }
`

const categoryOptions = [
  { value: "saas", label: "SaaS" },
  { value: "tool", label: "Tool" },
  { value: "api", label: "API" },
  { value: "ai", label: "AI / ML" },
  { value: "mobile", label: "Mobile" },
  { value: "other", label: "Other" },
]

export default function IdeaNew() {
  const navigate = useNavigate()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [source, setSource] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [error, setError] = useState("")

  const [createIdea, { loading: creating }] = useMutation<{ createIdea: { documentId: string; title: string } }>(CREATE_IDEA)

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      const tag = tagInput.trim().toLowerCase()
      if (tag && !tags.includes(tag)) {
        setTags([...tags, tag])
      }
      setTagInput("")
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Title is required")
      return
    }
    if (!description.trim()) {
      setError("Description is required")
      return
    }
    setError("")

    try {
      const { data } = await createIdea({
        variables: {
          data: {
            title: title.trim(),
            description: description.trim(),
            category: category || "other",
            source: source || "manual",
            tags,
            status: "captured",
          },
        },
      })

      const ideaId = data?.createIdea?.documentId
      navigate(ideaId ? `/ideas/${ideaId}` : "/ideas")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create idea")
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Quick Capture</h1>
        <p className="text-muted-foreground">Capture a new idea quickly</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Idea</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Title *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My brilliant idea..."
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description *</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your idea..."
                rows={4}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Select category</option>
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Source</label>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="e.g. customer feedback, brainstorm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs"
                  >
                    {tag}
                    <button onClick={() => handleRemoveTag(tag)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="Type a tag and press Enter"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={creating}
                className="flex-1"
              >
                <Save className="h-4 w-4" />
                {creating ? "Creating..." : "Save Idea"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
