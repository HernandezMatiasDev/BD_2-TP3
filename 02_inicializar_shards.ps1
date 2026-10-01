Write-Host "Inicializando Shard 1..."
docker exec -it basededatos-s1n1-1 mongosh --port 27020 --eval "rs.initiate({_id: 'shard1', members: [{_id: 0, host: 's1n1:27020'}, {_id: 1, host: 's1n2:27020'}, {_id: 2, host: 's1n3:27020'}]})"

Write-Host "Inicializando Shard 2..."
docker exec -it basededatos-s2n1-1 mongosh --port 27021 --eval "rs.initiate({_id: 'shard2', members: [{_id: 0, host: 's2n1:27021'}, {_id: 1, host: 's2n2:27021'}, {_id: 2, host: 's2n3:27021'}]})"

Write-Host "Inicializando Shard 3..."
docker exec -it basededatos-s3n1-1 mongosh --port 27022 --eval "rs.initiate({_id: 'shard3', members: [{_id: 0, host: 's3n1:27022'}, {_id: 1, host: 's3n2:27022'}, {_id: 2, host: 's3n3:27022'}]})"

Write-Host "Completado."