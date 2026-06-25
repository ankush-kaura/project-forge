"""
Project Forge Telegram Bot
Full owner control: create, list, search, status, analyze, prioritize,
generate repo, delete, and manage ideas via Strapi API.

Extended with: brainstorm, Q&A, build, and refinement commands.
"""

import os
RECONNECT_DELAY = 5  # seconds between reconnection attempts
import json
import time
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import quote

# Config
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
STRAPI_URL = os.environ.get("STRAPI_URL", "http://backend:1337")
ALLOWED_USERS = os.environ.get("ALLOWED_USERS", "").split(",")
STRAPI_API_TOKEN = os.environ.get("STRAPI_API_TOKEN", "")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("project-forge-bot")

# In-memory Q&A state tracking: {chat_id: {"session_id": ..., "questions": [...], "index": 0}}
_qa_state: dict = {}


def parse_telegram_command(text: str) -> tuple[str, str]:
    """Return (/command, args), preserving args for /cmd@BotName arg."""
    if not text.startswith("/"):
        return "", text.strip()
    first, _, rest = text.partition(" ")
    command = first.split("@", 1)[0].strip()
    return command, rest.strip()


# ---------------------------------------------------------------------------
# Telegram helpers
# ---------------------------------------------------------------------------

def telegram_api(method: str, data: dict = None) -> dict:
    """Call Telegram Bot API."""
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/{method}"
    if data:
        req = Request(url, data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    else:
        req = Request(url)
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except URLError as e:
        logger.error(f"Telegram API error: {e}")
        return {"ok": False, "error": str(e)}


def send_message(chat_id: int, text: str, parse_mode: str = "Markdown"):
    """Send a message to a Telegram chat, auto-falling back to plain text on parse errors."""
    result = telegram_api("sendMessage", {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    })
    # If Markdown parse failed, retry as plain text
    if not result.get("ok") and "parse" in str(result.get("description", "")).lower():
        telegram_api("sendMessage", {
            "chat_id": chat_id,
            "text": _strip_md(text),
            "parse_mode": "",
        })


def _strip_md(text: str) -> str:
    """Strip Markdown formatting for fallback plain-text send."""
    for ch in ["*", "_", "`", "[", "]"]:
        text = text.replace(ch, "")
    return text


def _esc(text: str) -> str:
    """Escape text for Telegram Markdown (V1): escape * _ ` ["""
    if not text:
        return ""
    for ch in ["*", "_", "`", "["]:
        text = text.replace(ch, f"\\{ch}")
    return text


# ---------------------------------------------------------------------------
# Strapi helpers
# ---------------------------------------------------------------------------

def strapi_api(method: str, endpoint: str, data: dict = None, timeout: int = 30) -> dict:
    """Call Strapi REST API with proper URL encoding."""
    # Split query string from path so we only encode the path portion
    if "?" in endpoint:
        path, qs = endpoint.split("?", 1)
        # Encode each path segment individually (preserving /)
        encoded_path = "/".join(quote(seg, safe="") for seg in path.split("/"))
        url = f"{STRAPI_URL}/api/{encoded_path}?{qs}"
    else:
        encoded_path = "/".join(quote(seg, safe="") for seg in endpoint.split("/"))
        url = f"{STRAPI_URL}/api/{encoded_path}"

    headers = {"Content-Type": "application/json"}
    if STRAPI_API_TOKEN:
        headers["Authorization"] = f"Bearer {STRAPI_API_TOKEN}"

    body = json.dumps(data).encode() if data else None
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode()[:300]
        except Exception:
            pass
        logger.error(f"Strapi API error: {e.code} {e.reason} — {body_text}")
        return {"error": f"HTTP {e.code}: {body_text or e.reason}"}
    except URLError as e:
        logger.error(f"Strapi API error: {e}")
        return {"error": str(e)}


def strapi_get_idea(idea_id: str) -> dict | None:
    """Fetch a single idea by documentId with all relations populated."""
    result = strapi_api("GET", f"ideas/{idea_id}?populate=*")
    if "error" in result:
        return None
    return result.get("data")


def strapi_find_idea_by_partial(partial: str) -> dict | None:
    """Try to find an idea by partial documentId prefix match."""
    # First try exact match
    idea = strapi_get_idea(partial)
    if idea:
        return idea
    # Search by documentId startsWith (Strapi doesn't support this natively,
    # so fetch recent and match prefix)
    result = strapi_api("GET", "ideas?sort=createdAt:desc&pagination[limit]=50")
    if "error" in result:
        return None
    for idea in result.get("data", []):
        if idea.get("documentId", "").startswith(partial):
            return strapi_get_idea(idea["documentId"])
    return None


def resolve_idea_id(user_input: str) -> tuple[str | None, str | None]:
    """Resolve user input to a full documentId. Returns (documentId, error_message)."""
    user_input = user_input.strip()
    if not user_input:
        return None, "❌ Please provide an idea ID. Use /list to see available ideas."
    # Direct lookup
    idea = strapi_get_idea(user_input)
    if idea:
        return user_input, None
    # Prefix match
    idea = strapi_find_idea_by_partial(user_input)
    if idea:
        return idea["documentId"], None
    return None, f"❌ Idea not found: `{_esc(user_input)}`\nUse /list to see available ideas."


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------

def handle_start(chat_id: int):
    """Handle /start command."""
    send_message(chat_id, (
        "🔨 *Project Forge Bot*\n\n"
        "Your AI\\-powered second brain for ideas\\. Control everything from here:\n\n"
        "*📝 Idea Management*\n"
        "• Send any message → saves as idea\n"
        "• `/new <title> — <desc>` — create with details\n"
        "• `/list` — recent ideas\n"
        "• `/search <query>` — search by title\n"
        "• `/status <id>` — full idea details\n"
        "• `/delete <id>` — delete an idea\n\n"
        "*🤖 AI & Development*\n"
        "• `/analyze <id>` — AI viability analysis\n"
        "• `/prioritize <id> <rev> <int> <opp> <cplx>` — score 1\\-10\n"
        "• `/dev <id>` — generate repo & start building\n\n"
        "*🧠 Brainstorm & Q&A*\n"
        "• `/brainstorm <id>` — start brainstorm\n"
        "• `/choose <sid> <opt#>` — pick architecture\n"
        "• `/approve_arch <sid>` — approve arch\n"
        "• `/start_qa <sid>` — begin Q&A\n"
        "• `/confirm_answers <sid>` — approve plan\n\n"
        "*🔨 Build & Refine*\n"
        "• `/build <sid>` — start building\n"
        "• `/build_status <sid>` — check progress\n"
        "• `/approve_layer <sid> <layer>` — approve layer\n"
        "• `/push <sid>` — push to GitHub\n"
        "• `/refine <sid> <desc>` — refinement request\n\n"
        "*⚡ One-Command Pipeline*\n"
        "• `/forge <idea_id>` — run full pipeline \\(picks arch, awaits approval\\)\n"
        "• `/approve <session_id>` — approve plan & build\n"
        "• `/forgehealth` — provider/model/config status\n\n"
        "*ℹ️ Other*\n"
        "• `/help` — all commands\n\n"
        "_Just send me an idea and I'll capture it\\. Use the short ID prefix shown in /list for commands\\._"
    ))


def handle_help(chat_id: int):
    """Show full help with all commands."""
    send_message(chat_id, (
        "🔨 *Project Forge Bot — Commands*\n\n"
        "*📝 Idea Management*\n"
        "• Send any message → saves as idea\n"
        "• `/new <title> — <desc>` — create with details\n"
        "• `/list` — recent ideas\n"
        "• `/search <query>` — search by title\n"
        "• `/status <id>` — full idea details\n"
        "• `/delete <id>` — delete an idea\n\n"
        "*🤖 AI & Development*\n"
        "• `/analyze <id>` — AI viability analysis\n"
        "• `/prioritize <id> <rev> <int> <opp> <cplx>` — score 1\\-10\n"
        "• `/dev <id>` — generate repo & start building\n\n"
        "*🧠 Brainstorm & Architecture*\n"
        "• `/brainstorm <idea-id>` — start brainstorm session\n"
        "• `/choose <session-id> <option#>` — pick architecture\n"
        "• `/approve_arch <session-id>` — approve architecture\n\n"
        "*❓ Q&A / Plan*\n"
        "• `/start_qa <session-id>` — begin questions\n"
        "• Reply with a number or text to answer each question\n"
        "• `/confirm_answers <session-id>` — approve plan\n\n"
        "*🔨 Build*\n"
        "• `/build <session-id>` — start building\n"
        "• `/build_status <session-id>` — check progress\n"
        "• `/approve_layer <session-id> <layer>` — approve a layer\n"
        "• `/push <session-id>` — push to GitHub\n\n"
        "*🔄 Refinement*\n"
        "• `/refine <session-id> <description>` — request refinement\n\n"
        "*⚡ One-Command Pipeline*\n"
        "• `/forge <idea-id>` — run full pipeline \\(selects arch, awaits approval\\)\n"
        "• `/approve <session-id>` — approve plan & build \\(runs for several minutes\\)\n"
        "• `/forgehealth` — provider/model/config status\n\n"
        "*ℹ️ Other*\n"
        "• `/help` — this message\n"
    ))


def handle_new(chat_id: int, text: str):
    """Handle /new command — create an idea."""
    parts = text.split("—", 1)
    if len(parts) == 1:
        parts = text.split(" - ", 1)

    title = parts[0].strip()
    description = parts[1].strip() if len(parts) > 1 else ""

    # For plain messages without a delimiter: first line = title, rest = description
    if not description and "\n" in title:
        lines = title.split("\n", 1)
        title = lines[0].strip()
        description = lines[1].strip()

    # Truncate title to 200 chars as a safety net
    if len(title) > 200:
        if not description:
            description = title
        title = title[:197] + "..."

    if not title:
        send_message(chat_id, "❌ Please provide a title: `/new <title> — <description>`")
        return

    result = strapi_api("POST", "ideas", {
        "data": {
            "title": title,
            "description": description or f"Idea captured via Telegram: {title}",
            "status": "captured",
            "category": "other",
            "source": "telegram",
            "tags": ["telegram", "quick-capture"],
        }
    })

    if "error" in result:
        send_message(chat_id, f"❌ Failed to create idea: {result['error']}")
        return

    idea = result.get("data", {})
    doc_id = idea.get("documentId", "unknown")
    send_message(chat_id, (
        f"✅ *Idea Created!*\n\n"
        f"*Title:* {_esc(title)}\n"
        f"*ID:* `{doc_id}`\n"
        f"*Status:* captured\n\n"
        f"Next: `/analyze {doc_id}` to run AI analysis\\."
    ))


def handle_list(chat_id: int):
    """Handle /list command — show recent ideas."""
    result = strapi_api("GET", "ideas?sort=createdAt:desc&pagination[limit]=15&fields[0]=title&fields[1]=status&fields[2]=documentId&fields[3]=category")

    if "error" in result:
        send_message(chat_id, f"❌ Failed to fetch ideas: {result['error']}")
        return

    ideas = result.get("data", [])
    if not ideas:
        send_message(chat_id, "📭 No ideas yet! Send me a message to create one.")
        return

    lines = ["📋 *Recent Ideas:*\n"]
    status_emoji = {
        "captured": "📝",
        "analyzing": "⏳",
        "analyzed": "🔬",
        "prioritized": "📊",
        "building": "🔨",
        "launched": "🚀",
        "archived": "📦",
    }

    for idea in ideas:
        emoji = status_emoji.get(idea.get("status", ""), "💡")
        doc_id = idea.get("documentId", "?")
        short_id = doc_id[:8]
        title = _esc(idea.get("title", "Untitled"))
        status = idea.get("status", "?")
        lines.append(f"{emoji} `{short_id}` — {title} \\[{status}\\]")

    lines.append(f"\n_Total: {len(ideas)} ideas\\. Use prefix ID for commands\\._")
    send_message(chat_id, "\n".join(lines))


def handle_search(chat_id: int, query: str):
    """Handle /search — search ideas by title."""
    if not query:
        send_message(chat_id, "❌ Usage: `/search <query>`")
        return

    # Strapi REST filter by title contains
    encoded_q = quote(query, safe="")
    result = strapi_api("GET", f"ideas?filters[title][$containsi]={encoded_q}&sort=createdAt:desc&pagination[limit]=10")

    if "error" in result:
        send_message(chat_id, f"❌ Search failed: {result['error']}")
        return

    ideas = result.get("data", [])
    if not ideas:
        send_message(chat_id, f"🔍 No ideas matching *{_esc(query)}*")
        return

    lines = [f"🔍 *Search results for:* {_esc(query)}\n"]
    for idea in ideas:
        doc_id = idea.get("documentId", "?")
        short_id = doc_id[:8]
        title = _esc(idea.get("title", "Untitled"))
        status = idea.get("status", "?")
        lines.append(f"• `{short_id}` — {title} \\[{status}\\]")

    send_message(chat_id, "\n".join(lines))


def handle_status(chat_id: int, raw_id: str):
    """Handle /status command — show full idea details."""
    doc_id, err = resolve_idea_id(raw_id)
    if err:
        send_message(chat_id, err)
        return

    idea = strapi_get_idea(doc_id)
    if not idea:
        send_message(chat_id, f"❌ Idea not found: `{_esc(raw_id)}`")
        return

    title = _esc(idea.get("title", "Unknown"))
    status = idea.get("status", "?")
    category = idea.get("category", "N/A")
    source = idea.get("source", "N/A")
    created = idea.get("createdAt", "?")[:10]
    description = (idea.get("description", "") or "")[:300]
    tags = idea.get("tags", [])

    text = f"💡 *{title}*\n\n"
    text += f"*ID:* `{doc_id}`\n"
    text += f"*Status:* {status}\n"
    text += f"*Category:* {category}\n"
    text += f"*Source:* {source}\n"
    text += f"*Created:* {created}\n"

    if tags and isinstance(tags, list):
        text += f"*Tags:* {', '.join(tags)}\n"

    text += f"\n📝 *Description:*\n{_esc(description)}\n"

    # Brainstorm session: backend exposes active-session lookup by idea id.
    # GET /api/brainstorm/:id expects a session id, not an idea id.
    brainstorm_result = strapi_api("GET", f"brainstorm/idea/{doc_id}/active")
    if brainstorm_result and "error" not in brainstorm_result:
        bs_data = brainstorm_result.get("data", brainstorm_result)
        bs_session = bs_data if isinstance(bs_data, dict) else {}
        if bs_session and bs_session.get("documentId"):
            text += f"\n🧠 *Brainstorm Session*\n"
            text += f"• Session: `{str(bs_session.get('documentId', '?'))}`\n"
            bs_status = bs_session.get("status", "?")
            text += f"• Status: {bs_status}\n"
            if bs_session.get("chosen_architecture"):
                arch = bs_session["chosen_architecture"]
                arch_name = arch.get("name", arch.get("title", "?")) if isinstance(arch, dict) else str(arch)
                text += f"• Architecture: {_esc(str(arch_name))}\n"
            if bs_session.get("layers"):
                text += f"• Layers: {len(bs_session['layers'])}\n"

    # Analysis
    analysis = idea.get("analysis")
    if analysis:
        text += f"\n📊 *Analysis*\n"
        vs = analysis.get("viability_score", "N/A")
        text += f"• Viability: {vs}/100\n"
        text += "• Revenue: " + str(analysis.get('revenue_potential', 'N/A')) + "\n"
        text += f"• Complexity: {analysis.get('technical_complexity', 'N/A')}\n"
        text += f"• Effort: ~{analysis.get('dev_effort_hours', 'N/A')}h\n"
        if analysis.get("market_opportunity"):
            text += f"• Market: {_esc(analysis['market_opportunity'][:150])}\n"

    # Priority
    priority = idea.get("priority")
    if priority:
        text += f"\n🏆 *Priority*\n"
        text += f"• Score: {priority.get('final_score', 'N/A')}\n"
        text += f"• Rank: #{priority.get('rank', 'N/A')}\n"
        text += f"• Revenue: {priority.get('revenue_score', '?')}/10 | Interest: {priority.get('interest_score', '?')}/10\n"
        text += f"• Opportunity: {priority.get('opportunity_score', '?')}/10 | Complexity: {priority.get('complexity_score', '?')}/10\n"

    # Repo
    repo = idea.get("repo")
    if repo:
        text += f"\n📦 *Repo*\n"
        text += f"• Name: {repo.get('repo_name', 'N/A')}\n"
        text += f"• URL: {repo.get('repo_url', 'N/A')}\n"
        text += f"• GitHub: {'✅' if repo.get('github_created') else '⏳ pending'}\n"

    # Notes
    notes = idea.get("notes")
    if notes and isinstance(notes, list) and len(notes) > 0:
        text += f"\n📎 *Notes:* {len(notes)}\n"

    send_message(chat_id, text)


def handle_delete(chat_id: int, raw_id: str):
    """Handle /delete command — delete an idea."""
    doc_id, err = resolve_idea_id(raw_id)
    if err:
        send_message(chat_id, err)
        return

    # Get the idea title first for confirmation
    idea = strapi_get_idea(doc_id)
    if not idea:
        send_message(chat_id, f"❌ Idea not found: `{_esc(raw_id)}`")
        return

    title = _esc(idea.get("title", "Unknown"))

    # Delete (unpublish + delete)
    strapi_api("DELETE", f"ideas/{doc_id}")
    # Also try to delete related analysis, priority, repo if they exist
    if idea.get("analysis"):
        strapi_api("DELETE", f"analyses/{idea['analysis']['documentId']}")
    if idea.get("priority"):
        strapi_api("DELETE", f"priorities/{idea['priority']['documentId']}")
    if idea.get("repo"):
        strapi_api("DELETE", f"repos/{idea['repo']['documentId']}")

    send_message(chat_id, f"🗑 *Deleted:* {title}\n\n`{doc_id}` has been permanently removed\\.")


def handle_analyze(chat_id: int, raw_id: str):
    """Handle /analyze command — trigger AI analysis."""
    doc_id, err = resolve_idea_id(raw_id)
    if err:
        send_message(chat_id, err)
        return

    send_message(chat_id, f"🔬 Analyzing `{doc_id[:8]}`\\.\\.\\. This may take a moment\\.")

    result = strapi_api("POST", f"ideas/{doc_id}/analyze")

    if "error" in result:
        send_message(chat_id, f"❌ Analysis failed: {result['error']}")
        return

    data = result.get("data", {})
    analysis = data.get("analysis", {})

    text = f"✅ *Analysis Complete!*\n\n"
    text += f"*Viability Score:* {analysis.get('viability_score', 'N/A')}/100\n"
    text += "*Revenue:* " + str(analysis.get('revenue_potential', 'N/A')) + "\n"
    text += f"*Complexity:* {analysis.get('technical_complexity', 'N/A')}\n"
    text += f"*Effort:* ~{analysis.get('dev_effort_hours', 'N/A')}h\n"
    text += f"\n_Next: `/prioritize {doc_id[:8]} <rev> <int> <opp> <cplx>` to score it\\._"

    send_message(chat_id, text)


def handle_prioritize(chat_id: int, args: str):
    """Handle /prioritize command — set priority scores."""
    parts = args.split()
    if len(parts) < 5:
        send_message(chat_id, (
            "❌ Usage: `/prioritize <id> <revenue> <interest> <opportunity> <complexity>`\n\n"
            "Each score: 1\\-10\n"
            "Example: `/prioritize abc12345 8 9 7 3`"
        ))
        return

    raw_id = parts[0]
    try:
        rev, interest, opp, cplx = int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4])
    except ValueError:
        send_message(chat_id, "❌ Scores must be numbers 1\\-10\\.")
        return

    for name, val in [("revenue", rev), ("interest", interest), ("opportunity", opp), ("complexity", cplx)]:
        if not 1 <= val <= 10:
            send_message(chat_id, f"❌ {name} must be 1\\-10, got {val}\\.")
            return

    doc_id, err = resolve_idea_id(raw_id)
    if err:
        send_message(chat_id, err)
        return

    result = strapi_api("POST", f"ideas/{doc_id}/prioritize", {
        "revenue_score": rev,
        "interest_score": interest,
        "opportunity_score": opp,
        "complexity_score": cplx,
    })

    if "error" in result:
        send_message(chat_id, f"❌ Prioritize failed: {result['error']}")
        return

    data = result.get("data", {})
    text = f"🏆 *Priority Set!*\n\n"
    text += f"*Score:* {data.get('final_score', 'N/A')}\n"
    text += f"*Rank:* #{data.get('rank', 'N/A')}\n"
    text += f"\n_Next: `/dev {doc_id[:8]}` to generate the repo\\._"

    send_message(chat_id, text)


def handle_dev(chat_id: int, raw_id: str):
    """Handle /dev command — generate repo and start building."""
    doc_id, err = resolve_idea_id(raw_id)
    if err:
        send_message(chat_id, err)
        return

    # Check idea status first
    idea = strapi_get_idea(doc_id)
    if not idea:
        send_message(chat_id, f"❌ Idea not found: `{_esc(raw_id)}`")
        return

    status = idea.get("status", "")
    title = _esc(idea.get("title", "Unknown"))

    if status == "building":
        repo = idea.get("repo", {})
        send_message(chat_id, (
            f"🔨 *Already Building!*\n\n"
            f"*Idea:* {title}\n"
            f"*Repo:* {repo.get('repo_url', 'N/A')}\n"
            f"*GitHub:* {'✅ created' if repo.get('github_created') else '⏳ pending'}"
        ))
        return

    send_message(chat_id, f"🔨 Generating repo for *{title}*\\.\\.\\.")

    result = strapi_api("POST", f"ideas/{doc_id}/generate-repo")

    if "error" in result:
        send_message(chat_id, f"❌ Repo generation failed: {result['error']}")
        return

    data = result.get("data", {})
    text = f"✅ *Repo Generated!*\n\n"
    text += f"*Idea:* {title}\n"
    text += "*Repo:* " + str(data.get('repo_name', 'N/A')) + "\n"
    text += f"*URL:* {data.get('repo_url', 'N/A')}\n"
    text += f"*Status:* building\n"
    text += f"\n_Idea is now in the build phase\\._"

    send_message(chat_id, text)


# ---------------------------------------------------------------------------
# Brainstorm / Q&A / Build / Refinement commands
# ---------------------------------------------------------------------------

def handle_brainstorm(chat_id: int, raw_id: str):
    """Handle /brainstorm — trigger brainstorm session for an idea."""
    doc_id, err = resolve_idea_id(raw_id)
    if err:
        send_message(chat_id, err)
        return

    send_message(chat_id, f"🧠 Starting brainstorm for `{doc_id[:8]}`\\.\\.\\. This may take a moment\\.")

    result = strapi_api("POST", f"brainstorm/{doc_id}")

    if "error" in result:
        send_message(chat_id, f"❌ Brainstorm failed: {result['error']}")
        return

    data = result.get("data", result)
    session = data.get("session") if isinstance(data.get("session"), dict) else {}
    session_id = data.get("session_id", session.get("documentId", data.get("documentId", data.get("id", "unknown"))))
    proposal = data.get("architecture_proposal", session.get("architecture_proposal", {}))
    options = proposal.get("options", data.get("architecture_options", data.get("options", []))) if isinstance(proposal, dict) else []

    text = f"🧠 *Brainstorm Session Started!*\n\n"
    text += f"*Session ID:* `{str(session_id)}`\n"

    if options:
        text += f"\n*Architecture Options:*\n"
        for i, opt in enumerate(options, 1):
            name = opt.get("name", opt.get("title", f"Option {i}"))
            desc = opt.get("description", "")
            text += f"\n*{i}\\. {_esc(str(name))}*\n"
            if desc:
                text += f"   {_esc(str(desc)[:200])}\n"
        text += f"\n_Reply with `/choose {str(session_id)} <number>` to select an architecture\\._"
    else:
        text += "\n_No architecture options returned\\. Check /status for the idea\\._"

    send_message(chat_id, text)


def handle_choose(chat_id: int, args: str):
    """Handle /choose — select architecture option."""
    parts = args.split()
    if len(parts) < 2:
        send_message(chat_id, "❌ Usage: `/choose <session-id> <option-number>`")
        return

    session_id = parts[0]
    try:
        option_num = int(parts[1])
    except ValueError:
        send_message(chat_id, "❌ Option number must be a number\\.")
        return

    result = strapi_api("PUT", f"brainstorm/{session_id}/choose", {"option_id": option_num})

    if "error" in result:
        send_message(chat_id, f"❌ Choose failed: {result['error']}")
        return

    data = result.get("data", result)
    selected = data.get("chosen", data.get("selected_option", data.get("option", {})))

    text = f"✅ *Architecture Selected!*\n\n"
    if isinstance(selected, dict):
        text += f"*Name:* {_esc(str(selected.get('name', selected.get('title', 'N/A'))))}\n"
        desc = selected.get("description", "")
        if desc:
            text += f"*Description:* {_esc(str(desc)[:300])}\n"
    else:
        text += f"*Option:* {selected}\n"

    text += f"\n_Next: `/approve_arch {session_id}` to approve and start Q&A\\._"
    send_message(chat_id, text)


def handle_approve_arch(chat_id: int, session_id: str):
    """Handle /approve_arch — approve architecture and generate questions."""
    session_id = session_id.strip()
    if not session_id:
        send_message(chat_id, "❌ Usage: `/approve_arch <session-id>`")
        return

    send_message(chat_id, f"✅ Approving architecture for `{session_id[:12]}`\\.\\.\\.")

    result = strapi_api("POST", f"brainstorm/{session_id}/approve", {"stage": "architecture"})

    if "error" in result:
        send_message(chat_id, f"❌ Approve failed: {result['error']}")
        return

    # Auto-generate questions
    strapi_api("POST", f"brainstorm/{session_id}/questions/generate")

    send_message(chat_id, (
        f"✅ *Architecture Approved!*\n\n"
        f"Questions have been generated\\.\n"
        f"_Next: `/start_qa {session_id}` to begin the Q&A flow\\._"
    ))


def handle_start_qa(chat_id: int, session_id: str):
    """Handle /start_qa — fetch questions and begin Q&A flow."""
    session_id = session_id.strip()
    if not session_id:
        send_message(chat_id, "❌ Usage: `/start_qa <session-id>`")
        return

    result = strapi_api("GET", f"brainstorm/{session_id}/questions")

    if "error" in result:
        send_message(chat_id, f"❌ Failed to fetch questions: {result['error']}")
        return

    questions = result.get("data", result.get("questions", []))
    if not questions:
        send_message(chat_id, "📭 No questions found\\. Try `/approve_arch` first\\.")
        return

    # Store state
    _qa_state[chat_id] = {
        "session_id": session_id,
        "questions": questions,
        "index": 0,
    }

    _send_qa_question(chat_id)


def _send_qa_question(chat_id: int):
    """Send the current Q&A question to the chat."""
    state = _qa_state.get(chat_id)
    if not state:
        send_message(chat_id, "❌ No active Q&A session\\. Use `/start_qa` first\\.")
        return

    idx = state["index"]
    questions = state["questions"]

    if idx >= len(questions):
        # All done
        send_message(chat_id, (
            f"✅ *All {len(questions)} questions answered!*\n\n"
            f"_Next: `/confirm_answers {state['session_id']}` to approve the plan\\._"
        ))
        del _qa_state[chat_id]
        return

    q = questions[idx]
    q_text = q.get("question_text", q.get("text", q.get("question", q.get("content", "Unknown question"))))
    options = q.get("options", q.get("choices", []))

    text = f"❓ *Question {idx + 1}/{len(questions)}*\n\n"
    text += f"{_esc(str(q_text))}\n"

    if options and isinstance(options, list):
        text += "\n"
        for i, opt in enumerate(options, 1):
            opt_text = opt.get("text", opt.get("label", str(opt))) if isinstance(opt, dict) else str(opt)
            text += f"{i}\\. {_esc(str(opt_text))}\n"
        text += f"\n_Reply with a number to choose, or type your own answer\\._"
    else:
        text += f"\n_Type your answer\\._"

    send_message(chat_id, text)


def handle_qa_answer(chat_id: int, answer_text: str):
    """Handle a user reply during an active Q&A session. Returns True if handled."""
    state = _qa_state.get(chat_id)
    if not state:
        return False  # Not in Q&A mode

    idx = state["index"]
    questions = state["questions"]
    if idx >= len(questions):
        del _qa_state[chat_id]
        return False

    q = questions[idx]
    q_id = q.get("documentId", q.get("id", ""))
    session_id = state["session_id"]

    # Save answer via API
    endpoint = f"brainstorm/{session_id}/questions/{q_id}/answer"
    strapi_api("POST", endpoint, {"answer": answer_text})

    # Advance
    state["index"] = idx + 1

    if state["index"] >= len(questions):
        send_message(chat_id, (
            f"✅ *All {len(questions)} questions answered!*\n\n"
            f"_Next: `/confirm_answers {session_id}` to approve the plan\\._"
        ))
        del _qa_state[chat_id]
    else:
        _send_qa_question(chat_id)

    return True  # Handled


def handle_confirm_answers(chat_id: int, session_id: str):
    """Handle /confirm_answers — approve the plan stage."""
    session_id = session_id.strip()
    if not session_id:
        send_message(chat_id, "❌ Usage: `/confirm_answers <session-id>`")
        return

    result = strapi_api("POST", f"brainstorm/{session_id}/approve", {"stage": "plan"})

    if "error" in result:
        send_message(chat_id, f"❌ Confirm failed: {result['error']}")
        return

    data = result.get("data", result)
    layers = data.get("layers", data.get("build_layers", []))

    text = f"✅ *Plan Approved!*\n\n"
    if layers:
        text += "*Build Layers:*\n"
        for i, layer in enumerate(layers, 1):
            name = layer.get("name", layer.get("title", f"Layer {i}")) if isinstance(layer, dict) else str(layer)
            text += f"  {i}\\. {_esc(str(name))}\n"
    text += f"\n_Next: `/build {session_id}` to start building\\._"
    send_message(chat_id, text)


def handle_build(chat_id: int, session_id: str):
    """Handle /build — start building layers."""
    session_id = session_id.strip()
    if not session_id:
        send_message(chat_id, "❌ Usage: `/build <session-id>`")
        return

    # Set default layers if not set. Must match backend's accepted layer enum.
    default_layers = ["database_schema", "api_backend", "frontend", "auth", "docker", "tests", "docs"]
    layer_result = strapi_api("POST", f"brainstorm/{session_id}/layers", {"layers": default_layers})
    if "error" in layer_result:
        send_message(chat_id, f"❌ Could not set build layers: {layer_result['error']}")
        return

    send_message(chat_id, f"🔨 Starting build for `{session_id[:12]}`\\.\\.\\.")

    result = strapi_api("POST", f"build/{session_id}/start")

    if "error" in result:
        send_message(chat_id, f"❌ Build start failed: {result['error']}")
        return

    data = result.get("data", result)
    status = data.get("status", "started")

    text = f"🔨 *Build Started!*\n\n"
    text += f"*Session:* `{session_id[:12]}`\n"
    text += f"*Status:* {status}\n"

    layers = data.get("layers", data.get("build_layers", []))
    if layers:
        text += "\n*Layers:*\n"
        for layer in layers:
            name = layer.get("name", layer.get("title", "?")) if isinstance(layer, dict) else str(layer)
            lstatus = layer.get("status", "pending") if isinstance(layer, dict) else "pending"
            emoji = "✅" if lstatus == "completed" else "🔨" if lstatus == "building" else "⏳"
            text += f"  {emoji} {_esc(str(name))} \\[{lstatus}\\]\n"

    text += f"\n_Use `/build_status {session_id}` to check progress\\._"
    send_message(chat_id, text)


def handle_build_status(chat_id: int, session_id: str):
    """Handle /build_status — check build progress."""
    session_id = session_id.strip()
    if not session_id:
        send_message(chat_id, "❌ Usage: `/build_status <session-id>`")
        return

    result = strapi_api("GET", f"build/{session_id}/status")

    if "error" in result:
        send_message(chat_id, f"❌ Status check failed: {result['error']}")
        return

    data = result.get("data", result)
    status = data.get("status", "unknown")
    layers = data.get("layers", data.get("build_layers", []))

    text = f"🔨 *Build Status*\n\n"
    text += f"*Session:* `{session_id[:12]}`\n"
    text += f"*Overall:* {status}\n"

    if layers:
        text += "\n*Layers:*\n"
        for layer in layers:
            if isinstance(layer, dict):
                name = layer.get("name", layer.get("title", "?"))
                lstatus = layer.get("status", "pending")
            else:
                name = str(layer)
                lstatus = "pending"
            emoji = "✅" if lstatus == "completed" else "🔨" if lstatus == "building" else "⏳"
            text += f"  {emoji} {_esc(str(name))} \\[{lstatus}\\]\n"
            if isinstance(layer, dict) and layer.get("error"):
                text += f"     ⚠️ {_esc(str(layer['error'])[:150])}\n"

    if status == "completed":
        text += f"\n_Next: `/push {session_id}` to push to GitHub\\._"
    elif layers:
        # Find first completed-but-not-approved layer
        for layer in layers:
            if isinstance(layer, dict) and layer.get("status") == "completed":
                lname = layer.get("layer", layer.get("name", layer.get("title", "?")))
                text += f"\n_Approve with `/approve_layer {session_id} {_esc(str(lname))}`\\._"
                break

    send_message(chat_id, text)


def handle_approve_layer(chat_id: int, args: str):
    """Handle /approve_layer — approve a completed build layer."""
    parts = args.split(None, 1)
    if len(parts) < 2:
        send_message(chat_id, "❌ Usage: `/approve_layer <session-id> <layer-name>`")
        return

    session_id = parts[0].strip()
    layer = parts[1].strip()

    result = strapi_api("POST", f"build/{session_id}/layer/{layer}/approve")

    if "error" in result:
        send_message(chat_id, f"❌ Approve layer failed: {result['error']}")
        return

    send_message(chat_id, (
        f"✅ *Layer Approved:* {_esc(layer)}\n\n"
        f"_Use `/build_status {session_id}` to check next layers\\._"
    ))


def handle_push(chat_id: int, session_id: str):
    """Handle /push — push build to GitHub."""
    session_id = session_id.strip()
    if not session_id:
        send_message(chat_id, "❌ Usage: `/push <session-id>`")
        return

    send_message(chat_id, f"📤 Pushing `{session_id[:12]}` to GitHub\\.\\.\\.")

    result = strapi_api("POST", f"build/{session_id}/push")

    if "error" in result:
        send_message(chat_id, f"❌ Push failed: {result['error']}")
        return

    data = result.get("data", result)
    repo_url = data.get("repo_url", data.get("url", "N/A"))

    send_message(chat_id, (
        f"✅ *Pushed to GitHub!*\n\n"
        f"*Session:* `{session_id[:12]}`\n"
        f"*Repo:* {repo_url}\n\n"
        f"_Use `/refine {session_id} <description>` to request refinements\\._"
    ))


def handle_refine(chat_id: int, args: str):
    """Handle /refine — submit a refinement request."""
    parts = args.split(None, 1)
    if len(parts) < 2:
        send_message(chat_id, "❌ Usage: `/refine <session-id> <description>`")
        return

    session_id = parts[0].strip()
    description = parts[1].strip()

    if not description:
        send_message(chat_id, "❌ Please provide a refinement description\\.")
        return

    result = strapi_api("POST", f"refine/{session_id}", {"request_text": description})

    if "error" in result:
        send_message(chat_id, f"❌ Refinement failed: {result['error']}")
        return

    data = result.get("data", result)
    text = f"🔄 *Refinement Submitted!*\n\n"
    text += f"*Session:* `{session_id[:12]}`\n"
    text += f"*Request:* {_esc(description[:200])}\n"

    if data.get("changes"):
        text += f"\n*Changes:*\n"
        changes = data["changes"]
        if isinstance(changes, list):
            for change in changes[:10]:
                text += f"• {_esc(str(change)[:150])}\n"
        else:
            text += f"{_esc(str(changes)[:300])}\n"

    send_message(chat_id, text)


# ---------------------------------------------------------------------------
# Forge pipeline commands
# ---------------------------------------------------------------------------

def handle_forge(chat_id: int, idea_id: str):
    """Handle /forge <idea_id> — run the one-command pipeline for an idea."""
    idea_id = idea_id.strip()
    if not idea_id:
        send_message(chat_id, "❌ Usage: `/forge <idea_id>`\nUse /list to see available IDs\\.")
        return

    send_message(chat_id, f"🔨 Running forge pipeline for `{_esc(idea_id)}`\\.\\.\\.")

    result = strapi_api("POST", f"forge/{idea_id}/run")

    if "error" in result:
        send_message(chat_id, f"❌ Forge run failed: {result['error']}")
        return

    data = result.get("data", result)
    session_id = data.get("session_id", data.get("sessionId", data.get("id", "unknown")))
    arch_name = data.get("architecture", data.get("architecture_name", data.get("arch", "unknown")))

    text = (
        f"🏗 *Architecture Selected:* {_esc(str(arch_name))}\n\n"
        f"⏳ *Status:* AWAITING PLAN APPROVAL\n\n"
        f"*Session ID:* `{_esc(str(session_id))}`\n\n"
        f"_Send `/approve {_esc(str(session_id))}` to approve and start building\\._"
    )
    send_message(chat_id, text)


def handle_approve(chat_id: int, session_id: str):
    """Handle /approve <session_id> — continue the forge pipeline (build phase)."""
    session_id = session_id.strip()
    if not session_id:
        send_message(chat_id, "❌ Usage: `/approve <session_id>`")
        return

    send_message(chat_id, (
        f"🔨 *Building\\.\\.\\.*\n\n"
        f"*Session:* `{_esc(session_id)}`\n\n"
        f"_This may take several minutes — please wait\\._"
    ))

    # Generous timeout: build pipeline can run for many minutes
    result = strapi_api("POST", f"forge/{session_id}/continue", timeout=1800)

    if "error" in result:
        send_message(chat_id, f"❌ Build failed: {result['error']}")
        return

    data = result.get("data", result)
    repo_url = data.get("repo_url", data.get("repoUrl", data.get("repository_url", "N/A")))
    deploy_url = data.get("deploy_url", data.get("deployUrl", data.get("deployment_url", "N/A")))

    text = (
        f"✅ *Build Complete!*\n\n"
        f"*Session:* `{_esc(session_id)}`\n\n"
        f"*Repo:* {_esc(str(repo_url))}\n"
        f"*Deploy:* {_esc(str(deploy_url))}\n"
    )
    send_message(chat_id, text)


def handle_forgehealth(chat_id: int):
    """Handle /forgehealth — show forge backend provider/model/config status."""
    result = strapi_api("GET", "forge/health")

    if "error" in result:
        send_message(chat_id, f"❌ Health check failed: {result['error']}")
        return

    data = result.get("data", result)

    lines = ["🟢 *Forge Health*\n"]

    provider = data.get("provider", data.get("llm_provider", "N/A"))
    model = data.get("model", data.get("llm_model", "N/A"))
    status = data.get("status", "N/A")

    lines.append(f"*Status:* {_esc(str(status))}")
    lines.append(f"*Provider:* {_esc(str(provider))}")
    lines.append(f"*Model:* {_esc(str(model))}")

    # Print any remaining top-level keys as config details
    skip_keys = {"provider", "llm_provider", "model", "llm_model", "status", "data"}
    for key, val in data.items():
        if key in skip_keys:
            continue
        if isinstance(val, dict):
            lines.append(f"\n*{_esc(str(key))}:*")
            for k, v in val.items():
                lines.append(f"  • {_esc(str(k))}: {_esc(str(v))}")
        elif isinstance(val, list):
            lines.append(f"*{_esc(str(key))}:* {', '.join(_esc(str(v)) for v in val)}")
        else:
            lines.append(f"*{_esc(str(key))}:* {_esc(str(val))}")

    send_message(chat_id, "\n".join(lines))


# ---------------------------------------------------------------------------
# Message router
# ---------------------------------------------------------------------------

def handle_message(update: dict):
    """Process an incoming Telegram update."""
    message = update.get("message")
    if not message:
        return

    chat_id = message["chat"]["id"]
    user_id = str(message.get("from", {}).get("id", ""))
    text = message.get("text", "").strip()

    # Check authorized users
    if ALLOWED_USERS and ALLOWED_USERS != [""] and user_id not in ALLOWED_USERS:
        send_message(chat_id, "⛔ Unauthorized. Add your Telegram ID to ALLOWED_USERS.")
        logger.warning(f"Unauthorized user: {user_id}")
        return

    if not text:
        return

    # Route commands — strip @botname suffix only from command token, preserving args.
    cmd, args = parse_telegram_command(text)

    # If in active Q&A session, handle non-command text as answers
    if chat_id in _qa_state and not text.startswith("/"):
        handled = handle_qa_answer(chat_id, text)
        if handled:
            return

    if cmd == "/start":
        handle_start(chat_id)
    elif cmd == "/help":
        handle_help(chat_id)
    elif cmd == "/new" and args:
        handle_new(chat_id, args)
    elif cmd == "/new":
        send_message(chat_id, "❌ Usage: `/new <title> — <description>`")
    elif cmd == "/list":
        handle_list(chat_id)
    elif cmd == "/search" and args:
        handle_search(chat_id, args)
    elif cmd == "/search":
        send_message(chat_id, "❌ Usage: `/search <query>`")
    elif cmd == "/status" and args:
        handle_status(chat_id, args)
    elif cmd == "/status":
        send_message(chat_id, "❌ Usage: `/status <idea_id>`\nUse /list to see available IDs\\.")
    elif cmd == "/delete" and args:
        handle_delete(chat_id, args)
    elif cmd == "/delete":
        send_message(chat_id, "❌ Usage: `/delete <idea_id>`\nUse /list to see available IDs\\.")
    elif cmd == "/analyze" and args:
        handle_analyze(chat_id, args)
    elif cmd == "/analyze":
        send_message(chat_id, "❌ Usage: `/analyze <idea_id>`\nUse /list to see available IDs\\.")
    elif cmd == "/prioritize" and args:
        handle_prioritize(chat_id, args)
    elif cmd == "/prioritize":
        send_message(chat_id, (
            "❌ Usage: `/prioritize <id> <revenue> <interest> <opportunity> <complexity>`\n"
            "Each score: 1\\-10"
        ))
    elif cmd == "/dev" and args:
        handle_dev(chat_id, args)
    elif cmd == "/dev":
        send_message(chat_id, "❌ Usage: `/dev <idea_id>`\nUse /list to see available IDs\\.")
    # --- New brainstorm / Q&A / build / refine commands ---
    elif cmd == "/brainstorm" and args:
        handle_brainstorm(chat_id, args)
    elif cmd == "/brainstorm":
        send_message(chat_id, "❌ Usage: `/brainstorm <idea-id>`\nUse /list to see available IDs\\.")
    elif cmd == "/choose" and args:
        handle_choose(chat_id, args)
    elif cmd == "/choose":
        send_message(chat_id, "❌ Usage: `/choose <session-id> <option-number>`")
    elif cmd in ("/approve_arch", "/approve-arch") and args:
        handle_approve_arch(chat_id, args)
    elif cmd in ("/approve_arch", "/approve-arch"):
        send_message(chat_id, "❌ Usage: `/approve_arch <session-id>`")
    elif cmd in ("/start_qa", "/start-qa") and args:
        handle_start_qa(chat_id, args)
    elif cmd in ("/start_qa", "/start-qa"):
        send_message(chat_id, "❌ Usage: `/start_qa <session-id>`")
    elif cmd in ("/confirm_answers", "/confirm-answers") and args:
        handle_confirm_answers(chat_id, args)
    elif cmd in ("/confirm_answers", "/confirm-answers"):
        send_message(chat_id, "❌ Usage: `/confirm_answers <session-id>`")
    elif cmd in ("/build_status", "/build-status") and args:
        handle_build_status(chat_id, args)
    elif cmd in ("/build_status", "/build-status"):
        send_message(chat_id, "❌ Usage: `/build_status <session-id>`")
    elif cmd in ("/approve_layer", "/approve-layer") and args:
        handle_approve_layer(chat_id, args)
    elif cmd in ("/approve_layer", "/approve-layer"):
        send_message(chat_id, "❌ Usage: `/approve_layer <session-id> <layer-name>`")
    elif cmd == "/build" and args:
        handle_build(chat_id, args)
    elif cmd == "/build":
        send_message(chat_id, "❌ Usage: `/build <session-id>`")
    elif cmd == "/push" and args:
        handle_push(chat_id, args)
    elif cmd == "/push":
        send_message(chat_id, "❌ Usage: `/push <session-id>`")
    elif cmd == "/refine" and args:
        handle_refine(chat_id, args)
    elif cmd == "/refine":
        send_message(chat_id, "❌ Usage: `/refine <session-id> <description>`")
    # --- Forge pipeline commands ---
    elif cmd == "/forge" and args:
        handle_forge(chat_id, args)
    elif cmd == "/forge":
        send_message(chat_id, "❌ Usage: `/forge <idea_id>`\nUse /list to see available IDs\\.")
    elif cmd == "/approve" and args:
        handle_approve(chat_id, args)
    elif cmd == "/approve":
        send_message(chat_id, "❌ Usage: `/approve <session_id>`")
    elif cmd == "/forgehealth":
        handle_forgehealth(chat_id)
    elif text.startswith("/"):
        send_message(chat_id, "🤷 Unknown command. Try /help for all commands.")
    else:
        first_word = text.split(None, 1)[0].lower()
        command_hints = {
            "brainstorm": "/brainstorm <idea-id>",
            "choose": "/choose <session-id> <option-number>",
            "approve_arch": "/approve_arch <session-id>",
            "approve-arch": "/approve_arch <session-id>",
            "start_qa": "/start_qa <session-id>",
            "start-qa": "/start_qa <session-id>",
            "confirm_answers": "/confirm_answers <session-id>",
            "confirm-answers": "/confirm_answers <session-id>",
            "build": "/build <session-id>",
            "build_status": "/build_status <session-id>",
            "build-status": "/build_status <session-id>",
            "approve_layer": "/approve_layer <session-id> <layer-name>",
            "approve-layer": "/approve_layer <session-id> <layer-name>",
            "push": "/push <session-id>",
            "refine": "/refine <session-id> <description>",
            "forge": "/forge <idea-id>",
            "approve": "/approve <session-id>",
        }
        if first_word in command_hints:
            send_message(chat_id, f"🤖 Did you mean `{command_hints[first_word]}`? Commands need a leading `/`.")
            return
        # Plain text — create as idea
        handle_new(chat_id, text)


# ---------------------------------------------------------------------------
# HTTP server (webhook mode) + polling mode
# ---------------------------------------------------------------------------

class WebhookHandler(BaseHTTPRequestHandler):
    """HTTP handler for Telegram webhook."""

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        try:
            update = json.loads(body)
            handle_message(update)
        except Exception as e:
            logger.error(f"Error processing update: {e}")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    def do_GET(self):
        """Health check endpoint."""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "healthy", "service": "project-forge-bot"}).encode())

    def log_message(self, format, *args):
        logger.info(format % args)


def set_webhook():
    """Set the Telegram webhook URL."""
    webhook_url = os.environ.get("WEBHOOK_URL", "")
    if not webhook_url:
        logger.warning("WEBHOOK_URL not set — using polling mode")
        return False

    result = telegram_api("setWebhook", {
        "url": f"{webhook_url}/webhook",
        "allowed_updates": ["message"],
    })

    if result.get("ok"):
        logger.info(f"Webhook set to {webhook_url}/webhook")
        return True
    else:
        logger.error(f"Failed to set webhook: {result}")
        return False


def poll_updates():
    """Long-polling mode with error isolation per message."""
    logger.info("Starting polling mode...")
    offset = 0
    while True:
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/getUpdates?offset={offset}&timeout=30"
            req = Request(url)
            with urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())

            if data.get("ok"):
                for update in data.get("result", []):
                    # Always advance offset BEFORE processing to avoid infinite loops
                    offset = update["update_id"] + 1
                    try:
                        handle_message(update)
                    except Exception as e:
                        logger.error(f"Error handling update {update.get('update_id')}: {e}")
        except Exception as e:
            logger.error(f"Polling error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    if not TELEGRAM_TOKEN:
        logger.error("TELEGRAM_TOKEN is required!")
        exit(1)

    mode = os.environ.get("BOT_MODE", "webhook")
    port = int(os.environ.get("BOT_PORT", "8080"))

    if mode == "polling":
        poll_updates()
    else:
        # Set webhook and start HTTP server
        set_webhook()
        server = HTTPServer(("0.0.0.0", port), WebhookHandler)
        logger.info(f"Bot server starting on port {port}")
        server.serve_forever()
