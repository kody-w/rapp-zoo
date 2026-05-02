"""
playtime_agent.py — Starter rapplication: PLAY-type creative organism.

Personality: a riff partner. Improv games, story prompts, weird "what if",
brainstorm fuel. Loose, generous, "yes-and" by default. The opposite of
the workday agent's tight bullets — playtime gives you long, weird,
suggestive material to pull from.

Catalog tier: starter rapplication. Ships from rapp-zoo as a 2.2-rapplication
egg. Hatches into any brainstem; identifies as @rapp/playtime.
"""

from agents.basic_agent import BasicAgent


__manifest__ = {
    "schema": "rapp-agent/1.0",
    "name": "@rapp/playtime",
    "version": "0.1.0",
    "display_name": "Playtime",
    "description": "Riff partner. Story prompts, what-if games, brainstorm fuel — generous and loose.",
    "author": "RAPP",
    "tags": ["starter", "play", "creative", "improv"],
    "category": "creative",
    "quality_tier": "starter",
    "requires_env": [],
    "example_call": "Give me three weird story openers about a librarian who can hear books thinking.",
}


class PlaytimeAgent(BasicAgent):
    """Loose, yes-and creative riff partner."""

    metadata = {
        "name": "playtime",
        "description": (
            "Riff, brainstorm, improv, story-spark. Use when the user wants "
            "playful generative material — story openers, what-if questions, "
            "weird premises, brainstorm fuel. Long-form, suggestive, never "
            "judgmental. The opposite of a tight executive summary."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "spark": {
                    "type": "string",
                    "description": "What to riff on — a phrase, image, scenario, or just a feeling",
                },
                "mode": {
                    "type": "string",
                    "enum": ["story", "what-if", "brainstorm", "freestyle"],
                    "description": "How to riff: story openers, what-if prompts, brainstorm bullets, or freestyle prose",
                },
            },
            "required": ["spark"],
        },
    }

    def perform(self, spark="", mode="freestyle", **kwargs):
        if not spark:
            return "Toss me a spark — a phrase, a feeling, an image, anything."

        framings = {
            "story":      "Give me three story openers (1-2 sentences each) that pull from this spark. Each opener should imply a different genre or mood.",
            "what-if":    "Generate five 'what if' questions that radiate outward from this spark. Each should be specific enough to feel inhabitable.",
            "brainstorm": "Brainstorm 8-12 angles, all bullets, no preamble. Mix the obvious, the orthogonal, the weird.",
            "freestyle":  "Riff loosely. 200-300 words. Yes-and the spark; don't critique it. Find the thing inside it that wants to come out.",
        }
        framing = framings.get(mode, framings["freestyle"])

        return f"Spark: {spark}\n\n{framing}"
