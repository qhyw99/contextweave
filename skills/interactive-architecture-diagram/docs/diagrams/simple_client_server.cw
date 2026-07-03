# session_id: ea0926a0-7c44-4b0c-95c6-7606e3523bab
direction: down

client: Client {
  shape: rectangle
  style.fill: "#42A5F5"
  style.font-color: white
  style.bold: true
}

lb: Load Balancer {
  shape: hexagon
  style.fill: "#FFA726"
  style.font-color: white
  style.bold: true
  style.3d: true
}

backend: Backend Servers {
  style.fill: "#66BB6A"
  style.stroke: "#2E7D32"
  style.bold: true

  server1: Server 1
  server2: Server 2
  server3: Server 3
}

db: MySQL Database {
  shape: cylinder
  style.fill: "#4479A1"
  style.font-color: white
  style.bold: true
}

# Connections
client -> lb: HTTP Request {
  style.stroke: "#1565C0"
  style.stroke-width: 2
}

lb -> backend.server1: Forward {
  style.stroke: "#E65100"
  style.stroke-width: 2
}

lb -> backend.server2: Forward {
  style.stroke: "#E65100"
  style.stroke-width: 2
}

lb -> backend.server3: Forward {
  style.stroke: "#E65100"
  style.stroke-width: 2
}

backend.server1 -> db: SQL Query {
  style.stroke: "#1B5E20"
  style.stroke-width: 2
}

backend.server2 -> db: SQL Query {
  style.stroke: "#1B5E20"
  style.stroke-width: 2
}

backend.server3 -> db: SQL Query {
  style.stroke: "#1B5E20"
  style.stroke-width: 2
}

db -> backend.server1: Result {
  source-arrowhead: triangle
  style.stroke-dash: 3
  style.stroke: "#1B5E20"
}

db -> backend.server2: Result {
  source-arrowhead: triangle
  style.stroke-dash: 3
  style.stroke: "#1B5E20"
}

db -> backend.server3: Result {
  source-arrowhead: triangle
  style.stroke-dash: 3
  style.stroke: "#1B5E20"
}
