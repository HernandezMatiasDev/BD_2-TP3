Write-Host "Registrando los Shards en el enrutador (Mongos)..."
docker exec -it basededatos-mongos1-1 mongosh --port 27017 --eval "sh.addShard('shard1/s1n1:27020,s1n2:27020,s1n3:27020'); sh.addShard('shard2/s2n1:27021,s2n2:27021,s2n3:27021'); sh.addShard('shard3/s3n1:27022,s3n2:27022,s3n3:27022');"

Write-Host "Completado."