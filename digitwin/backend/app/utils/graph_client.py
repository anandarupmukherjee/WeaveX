"""Neo4j async client for knowledge graph operations."""

import structlog
from neo4j import AsyncGraphDatabase, AsyncDriver

from ..config import settings

logger = structlog.get_logger()


class Neo4jClient:
    """Async Neo4j client for the digital twin knowledge graph."""

    def __init__(self):
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )

    async def verify(self) -> bool:
        """Check that Neo4j is reachable."""
        try:
            await self._driver.verify_connectivity()
            return True
        except Exception as e:
            logger.error("Neo4j connection failed", error=str(e))
            return False

    async def close(self):
        await self._driver.close()

    async def run_query(self, query: str, params: dict | None = None) -> list[dict]:
        """Execute a Cypher query and return results as dicts."""
        async with self._driver.session() as session:
            result = await session.run(query, params or {})
            records = await result.data()
            return records

    # ---- Graph construction methods ----

    async def create_entity(
        self,
        entity_type: str,
        name: str,
        properties: dict,
        project_id: str,
    ) -> str:
        """Create an entity node. Returns the node's element ID."""
        query = f"""
        CREATE (n:{entity_type} {{
            name: $name,
            project_id: $project_id
        }})
        SET n += $properties
        RETURN elementId(n) AS id
        """
        result = await self.run_query(query, {
            "name": name,
            "project_id": project_id,
            "properties": properties,
        })
        return result[0]["id"] if result else ""

    async def create_relationship(
        self,
        source_id: str,
        target_id: str,
        rel_type: str,
        properties: dict | None = None,
    ):
        """Create a relationship between two nodes."""
        query = f"""
        MATCH (a), (b)
        WHERE elementId(a) = $source_id AND elementId(b) = $target_id
        CREATE (a)-[r:{rel_type}]->(b)
        SET r += $properties
        RETURN type(r) AS rel_type
        """
        await self.run_query(query, {
            "source_id": source_id,
            "target_id": target_id,
            "properties": properties or {},
        })

    async def get_project_graph(self, project_id: str) -> dict:
        """Retrieve all nodes and edges for a project."""
        nodes_query = """
        MATCH (n {project_id: $project_id})
        RETURN elementId(n) AS id, labels(n) AS labels,
               properties(n) AS props
        """
        edges_query = """
        MATCH (a {project_id: $project_id})-[r]->(b {project_id: $project_id})
        RETURN elementId(a) AS source, elementId(b) AS target,
               type(r) AS type, properties(r) AS props
        """
        nodes = await self.run_query(nodes_query, {"project_id": project_id})
        edges = await self.run_query(edges_query, {"project_id": project_id})
        return {"nodes": nodes, "edges": edges}

    async def clear_project(self, project_id: str):
        """Delete all nodes and relationships for a project."""
        await self.run_query(
            "MATCH (n {project_id: $pid}) DETACH DELETE n",
            {"pid": project_id},
        )
