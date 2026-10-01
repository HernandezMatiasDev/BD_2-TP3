Write-Host "Levantando la infraestructura de Docker..."
docker-compose up -d

Write-Host "Inicializando Servidores de Configuracion (rs-config)..."
docker exec -it basededatos-cfg1-1 mongosh --port 27019 --eval "rs.initiate({_id: 'rs-config', configsvr: true, members: [{_id: 0, host: 'cfg1:27019'}, {_id: 1, host: 'cfg2:27019'}, {_id: 2, host: 'cfg3:27019'}]})"

Write-Host "Completado."