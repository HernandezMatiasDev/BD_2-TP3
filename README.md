# TP3 – Base de Datos II: Red Social Distribuida con MongoDB

 [Trabajo pracito](./TP_03_Base_de_datos_II_-_Mongo_DB.pdf)


Este trabajo consiste en diseñar y levantar una base de datos distribuida en MongoDB para simular una red social (usuarios, publicaciones, comentarios e historias), aplicando conceptos de sharding, replicación, modelado documental e índices.

A continuación se documenta el proceso completo: desde cómo armé la infraestructura hasta las decisiones de diseño que fui tomando (y, en algunos casos, corrigiendo) a medida que avanzaba.

---

## 1. Arquitectura general

Decidí armar una base de datos **realmente distribuida** (un *sharded cluster*), y no solo una única instancia de Mongo, porque el objetivo del TP era simular un escenario cercano a la realidad; ademas toda la gracia de Mongo es que es una base de datos distribuida.

La arquitectura completa se compone de tres capas, más un balanceador de entrada:

<img width="2816" height="1536" alt="gemini_imagen_topologia" src="https://github.com/user-attachments/assets/32fbf8cb-3f72-424e-86d6-f467be955eeb" />


    (imagen generada con ia para ilustración) 

### 1.1. Capa de almacenamiento (los Shards)

Los datos reales (usuarios, publicaciones, comentarios, historias) están repartidos en **3 shards**. Cada shard, a su vez, **no es un único servidor sino un Replica Set de 3 nodos** (1 primario + 2 secundarios).

¿Por qué un Replica Set y no un solo nodo por shard? Porque si dependiera de un único servidor por partición, la caída de una sola máquina significaría perder ese tercio de los datos de la red social. Con 3 nodos por shard, si el primario se cae, uno de los secundarios es elegido automáticamente como nuevo primario y el servicio sigue funcionando sin pérdida de información.

### 1.2. Capa de metadatos (Config Servers)

Además de los shards, hay un **Replica Set de 3 servidores de configuración** (`rs-config`). Estos nodos no guardan documentos de usuarios o publicaciones: guardan el "mapa" del clúster, es decir, qué shard tiene cada rango de datos, qué colecciones están fragmentadas y con qué clave. Sin este mapa, el enrutador no tendría forma de saber a qué shard mandar cada consulta.

También se armó como Replica Set (y no como un único nodo) por el mismo motivo que los shards: si el clúster pierde su mapa de enrutamiento, deja de funcionar por completo, así que esta capa también necesita tolerancia a fallos.

### 1.3. Capa de enrutamiento (Mongos)

Los clientes (o, en este caso, yo conectándome con `mongosh` o Compass) nunca hablan directamente con los shards. Hablan con un **enrutador (`mongos`)**, que consulta el mapa de los config servers y decide a qué shard (o shards) reenviar cada operación.

Puse **2 instancias de `mongos`** en lugar de una sola, para que si uno de los dos enrutadores se cae, el otro pueda seguir atendiendo pedidos sin que el clúster quede inaccesible.

### 1.4. Balanceador de entrada (HAProxy)

Como ahora hay dos enrutadores, hace falta algo que reciba las conexiones de los clientes y las reparta entre `mongos1` y `mongos2`. Para eso usé **HAProxy**, configurado en modo TCP (capa 4, no entiende el protocolo de Mongo, solo reenvía bytes) con un algoritmo *round robin* entre los dos routers.

**Aclaración sobre el proxy:** soy consciente de que, tal como está armado, el HAProxy es en sí mismo un punto único de falla (*SPOF*) — si se cae el único contenedor de HAProxy, nadie puede conectarse al clúster, aunque los dos `mongos` sigan funcionando perfectamente. En un entorno real esto se resuelve de alguna de estas dos formas:

- **Smart drivers**: el driver de la aplicación cliente recibe la lista de IPs de *todos* los `mongos` disponibles y gestiona él mismo la alta disponibilidad (si uno no responde, prueba con el siguiente), sin necesitar ningún proxy en el medio.
- **IP virtual flotante (VRRP / Keepalived)**: se ponen dos o más nodos de proxy que comparten una misma IP "flotante". Si el proxy activo se cae, el otro toma esa IP en milisegundos.

Por limitaciones técnicas del entorno de este TP (recursos de la máquina donde se corre todo con Docker), opté por un solo nodo de HAProxy, y **lo trato conceptualmente como si tuviera esa resiliencia**, aclarando que en un despliegue real este punto se resolvería con alguna de las dos estrategias anteriores.

### 1.5. El costo de simular esto en una máquina local

Vale la pena hacer mención algo que no es estrictamente una decisión de diseño, pero sí un condicionante durante todo el desarrollo: levantar los 15 contenedores (14 nodos de Mongo + HAProxy) en una sola máquina, es pesado. El motor de Docker, con el clúster completo corriendo sin hacer nada todavía, ya consume varios gigas de RAM solo por mantener los 14 procesos de `mongod`/`mongos` en pie:

<img width="695" height="79" alt="ay_mi-ram" src="https://github.com/user-attachments/assets/9d9e5ba1-862d-431b-b6d9-968265ae4bf5" />


Y al momento de correr la carga masiva de datos (que se explica en la próxima sección) o consultas sobre el dataset completo, el uso de memoria de Docker llegó a superar eso, acercándose al límite de RAM disponible en la máquina:

<img width="655" height="166" alt="pesado" src="https://github.com/user-attachments/assets/3688784c-d610-47c4-aafb-5a93d6451959" />

---

## 2. Puesta en marcha del clúster

### 2.1. `docker-compose.yml`

Este archivo define y levanta los 15 contenedores explicados arriba: 1 HAProxy, 2 `mongos`, 3 `cfg` (config servers) y 9 nodos de datos (3 shards × 3 nodos).

[docker-compose.yml](./docker-compose.yml)

Algunas decisiones de diseño del archivo:

- **Uso de anclas YAML (`x-mongo-common: &mongo-common`)**: en vez de repetir 14 veces la misma imagen (`mongo:latest`) y política de reinicio (`restart: always`), se define una sola vez y se reutiliza con `<<: *mongo-common` en cada servicio. Es simplemente para no repetir código.
- **Aislamiento de red**: ningún contenedor expone puertos hacia la máquina host, excepto HAProxy (`27017:27017`). Todo lo demás se comunica solo puertas adentro de la red interna que crea Docker Compose. Esto simula que, en un entorno real, la base de datos no debería ser accesible directamente desde internet, solo a través del balanceador.
- **La bandera `command`** es la que le dice a cada contenedor de Mongo qué rol cumplir: `--shardsvr` para los nodos de datos, `--configsvr` para los de metadatos, y el binario `mongos` (en vez de `mongod`) para los enrutadores.

### 2.2. `01_levantar_y_config.ps1`

```powershell
docker-compose up -d
docker exec -it basededatos-cfg1-1 mongosh --port 27019 --eval "rs.initiate({...})"
```

Este script hace dos cosas: primero levanta los 15 contenedores en segundo plano, y después inicializa el Replica Set de los servidores de configuración (`rs-config`), uniendo `cfg1`, `cfg2` y `cfg3` bajo un mismo grupo con el flag especial `configsvr: true`.

### 2.3. `02_inicializar_shards.ps1`

```powershell
docker exec -it basededatos-s1n1-1 mongosh --port 27020 --eval "rs.initiate({_id: 'shard1', ...})"
docker exec -it basededatos-s2n1-1 mongosh --port 27021 --eval "rs.initiate({_id: 'shard2', ...})"
docker exec -it basededatos-s3n1-1 mongosh --port 27022 --eval "rs.initiate({_id: 'shard3', ...})"
```

Acá se inicializan los tres Replica Sets de datos (`shard1`, `shard2`, `shard3`), cada uno agrupando sus 3 nodos correspondientes. Hasta este punto, cada shard funciona como una base de datos replicada independiente, pero todavía no sabe que forma parte de un clúster fragmentado más grande.

### 2.4. `03_registrar_shards.ps1`

```powershell
docker exec -it basededatos-mongos1-1 mongosh --port 27017 --eval "sh.addShard('shard1/s1n1:27020,s1n2:27020,s1n3:27020'); sh.addShard('shard2/...'); sh.addShard('shard3/...');"
```

Este es el paso que conecta todo lo anterior: le aviso a uno de los enrutadores (`mongos1`) que existen estos tres shards, para que los registre en el mapa de los config servers. A partir de acá, el clúster ya "sabe" que tiene tres particiones de datos disponibles.

### 2.5. `04_configurar_sharding.js`

```javascript
use red_social_tp3;
sh.enableSharding("red_social_tp3");

sh.shardCollection("red_social_tp3.usuarios", { _id: "hashed" });
sh.shardCollection("red_social_tp3.publicaciones", { autor_id: "hashed" });
sh.shardCollection("red_social_tp3.comentarios", { publicacion_id: "hashed" });
sh.shardCollection("red_social_tp3.historias", { _id: "hashed" });
```

Con la infraestructura ya vinculada, este script define las reglas de negocio: qué base de datos va a estar fragmentada y, para cada colección, cuál va a ser su **shard key** (el campo que Mongo usa para decidir en qué shard va cada documento).

Elegí **hash** como estrategia de fragmentación (en vez de por rango) para las cuatro colecciones, porque me garantiza una distribución pareja de los documentos entre los tres shards. Si hubiera elegido, por ejemplo, la fecha de creación como shard key con fragmentación por rango, todos los documentos nuevos irían siempre al mismo shard (el que tiene el rango más reciente), generando lo que se conoce como un *hot shard*.

#### ¿Por qué elegí cada shard key?

Elegir "hash" para las cuatro colecciones no fue una decisión automática: para cada una pensé **cómo se consulta en una red social** y qué campo me convenía que decidiera en qué shard vive cada documento. En un clúster no existen los `JOIN` como en SQL, así que lo que más me importaba era que las consultas más frecuentes pudieran resolverse yendo a **un solo shard** (consulta *dirigida*) y no preguntándole a los tres (*scatter-gather*).

- **`usuarios` → `{ _id: "hashed" }`**: la operación típica sobre un usuario es abrir su perfil, y eso es una búsqueda puntual por `_id` (por ejemplo, cuando alguien hace clic en el nombre del autor de una publicación, como se explica en el punto 3.1). Con el `_id` hasheado esa búsqueda va directo a un único shard. Además, un `ObjectId` es creciente (empieza con el timestamp de creación), así que si fragmentara por rango, los usuarios nuevos se acumularían siempre en el mismo shard; el hash evita ese *hot shard*.
- **`publicaciones` → `{ autor_id: "hashed" }`**: lo más pedido después del perfil es "las publicaciones de este usuario". Si la clave fuera el `_id` de la publicación, las publicaciones de un mismo autor quedarían desparramadas por todo el clúster y mostrar el perfil obligaría a consultar los tres shards. Con `autor_id` hasheado, **todas las publicaciones de un autor viven juntas en el mismo shard**, y esa consulta es dirigida.
- **`comentarios` → `{ publicacion_id: "hashed" }`**: es la colección más grande por lejos (más de 1,4 millones de documentos) y la operación más habitual sobre ella es "ver más comentarios" de una publicación. Con esta clave, **todos los comentarios de una misma publicación quedan en el mismo shard**, así que traerlos es una consulta dirigida. Si hubiera usado el `_id` del comentario, cada vez que alguien abre un post viral habría que recolectar comentarios de los tres shards.
- **`historias` → `{ _id: "hashed" }`**: acá no tenía un patrón de consulta tan marcado como en las otras tres, y el objetivo principal era repartir los documentos de forma pareja entre los shards, por eso usé el `_id` hasheado.

Como contrapartida, una clave hasheada **no sirve para consultas por rango** (por ejemplo, "publicaciones entre dos fechas"): esas consultas, y cualquiera que filtre por un campo que no es la shard key, no pueden dirigirse a un shard puntual y terminan consultando los tres. Esto se ve en la práctica en la sección 12.

Para ejecutar este archivo se lo inyecta directamente al enrutador vía una tubería de PowerShell:

```powershell
Get-Content 04_configurar_sharding.js | docker exec -i basededatos-mongos1-1 mongosh --port 27017
```

---

## 3. Diseño del modelo de datos

Una vez armada la infraestructura, definí la estructura de las 4 colecciones (`usuarios`, `publicaciones`, `comentarios`, `historias`). Acá la decisión más importante no fue tanto la infraestructura, sino **cómo relacionar los documentos entre sí**, sabiendo que en una base de datos distribuida no existen los `JOIN` como en SQL, y hacerlos "a mano" (una consulta por cada relación) es costoso, sobre todo si esos documentos relacionados terminan viviendo en shards distintos.

### 3.1. Redundancia en `publicaciones`

Cada publicación guarda tanto el `autor_id` (la referencia real al usuario) como el `nombre_autor` (el nombre, duplicado). La idea es que, para mostrar el feed —que es la operación más frecuente de toda la red social—, no haga falta ir a buscar el usuario a la colección `usuarios` solo para mostrar su nombre. Si en algún momento el usuario cambia su nombre, voy a tener que actualizar ese dato en todas sus publicaciones, pero considero que ese costo es mucho menor comparado con el ahorro de no tener que resolver una consulta extra cada vez que alguien abre el feed.

Al mismo tiempo, mantengo el `autor_id` real, así que si alguien hace clic en el nombre del autor (para ir a su perfil completo), en ese momento sí vale la pena hacer la consulta a `usuarios` con ese id para poder buscar por hash.

### 3.2. Embedding de los últimos comentarios en `publicaciones`

En vez de que cada publicación solo tenga un contador de comentarios, decidí embeber directamente los **últimos 3 comentarios** dentro del propio documento de la publicación (`comentarios_recientes`). La lógica es la misma que con el nombre del autor: la vista normal de un post (ver la publicación con algunos comentarios recientes) es una operación de altísima frecuencia, y con este diseño se resuelve leyendo un solo documento, sin tener que consultar la colección `comentarios` aparte. En este momento pense en redes sociales como MercadoLibre que siempre muestran un par de comentarios y si el usuario hace clic explícitamente en "ver más comentarios", ahí sí voy a la colección `comentarios` (que tiene el historial completo, no solo los últimos 3) y traigo el resto.

### 3.3. Por qué los comentarios "viejos" no van todos embebidos

Si embebiera *todos* los comentarios de una publicación dentro de su propio documento, un post que se vuelve viral (con miles de comentarios) podría llegar a superar el límite de 16MB por documento que tiene MongoDB. Por eso los comentarios históricos se guardan como documentos independientes en su propia colección, cada uno con una referencia (`publicacion_id`) a la publicación a la que pertenecen — es el patrón conocido como *Subset Pattern*: se embebe solo un subconjunto (los más recientes/relevantes) y el resto se referencia aparte.

### 3.4. El diseño fue evolucionando

Vale la pena aclarar que este modelo no salió completo la primera vez que me senté a diseñarlo. Algunos campos los fui agregando a medida que me daba cuenta de que los necesitaba — por ejemplo, en un primer momento los comentarios embebidos en la publicación no guardaban el `_id` real del comentario ni el `autor_id` del usuario que lo escribió, solo el texto y el nombre. Cuando llegué a la parte de updates y me pregunté "¿cómo borro un comentario específico?", me di cuenta de que necesitaba guardar esa referencia desde el principio.

Esto me sirvió como aprendizaje concreto de algo que se dice mucho en la teoría pero que recién se entiende haciéndolo: en una base de datos distribuida, **el modelado se piensa antes**, porque corregir el esquema después de tener millones de documentos cargados (o ya en producción) es mucho más costoso que pensarlo bien en el diseño inicial.

---

## 4. Índices

Además del índice que Mongo crea automáticamente sobre la shard key de cada colección, agregué algunos índices secundarios pensando en cómo se usaría esta red social en la práctica (qué consultas se hacen todo el tiempo) y no "por las dudas".

### 4.1. ¿Cómo funcionan por dentro? (B-Tree)

Todos los índices de MongoDB (salvo casos muy particulares) se implementan internamente como un **árbol B** (*B-Tree*), específicamente una variante llamada B+Tree. Vale la pena entender por qué se elige esta estructura y no, por ejemplo, una búsqueda binaria simple sobre un arreglo ordenado.

La búsqueda binaria es muy rápida en teoría (`O(log n)`), pero asume que los datos están en memoria y en un arreglo contiguo. El problema es que una base de datos no vive solo en RAM: los datos están en disco, y el disco se lee de a **bloques/páginas**, no de a un valor suelto. Si usara un arreglo ordenado plano, insertar un solo documento en el medio implicaría correr de lugar todos los que están después, algo carísimo a la escala de millones de documentos.

Un árbol B resuelve esto organizando los datos en **nodos que contienen varias claves ordenadas** (no una sola), donde cada nodo corresponde más o menos a una página de disco. Esto tiene dos ventajas concretas:

- **Menos lecturas de disco por búsqueda**: como cada nodo trae varias claves de una sola vez, el árbol es "ancho y bajo" (poca altura), así que se necesitan pocos saltos entre nodos para encontrar cualquier documento, y cada salto es una lectura de disco.
- **Inserciones más baratas que un arreglo ordenado**: cuando un nodo se llena, el árbol simplemente lo divide en dos (*split*) y reacomoda el árbol localmente, en vez de tener que mover todos los datos de la colección.

Concretamente en MongoDB, cada índice (el de la shard key y cualquier índice secundario) es un B-Tree independiente, y ese árbol se guarda **en cada shard, localmente**, indexando solo los documentos que le tocaron a ese shard.

### 4.2. Por qué no indexo "todo lo que se pueda consultar"

Cada índice tiene un costo, y no es gratis mantenerlo: cada vez que se inserta, actualiza o borra un documento, Mongo tiene que actualizar **todos** los árboles B de esa colección, no solo los datos. Si una colección tuviera, por ejemplo, 6 índices, cada `insert` implica 6 escrituras de árbol en lugar de 1, además del espacio en disco y en memoria que ocupa cada árbol.

Por eso, en vez de indexar cualquier campo que en algún momento se podría llegar a consultar, elegí indexar solo los campos que corresponden a las **consultas de alta frecuencia** de una red social real: el feed ordenado por fecha, el ranking de publicaciones por likes, la búsqueda por hashtag, y algunos filtros de usuarios (seguidores, edad, ciudad). Campos que se consultan poco frecuentemente, o que tienen baja selectividad (que no achican mucho el conjunto de resultados), los dejé sin indexar a propósito.

```javascript
// usuarios
db.usuarios.createIndex({ seguidores: 1 }, { name: "idx_seguidores" });
db.usuarios.createIndex({ edad: 1 }, { name: "idx_edad" });
db.usuarios.createIndex({ ciudad: 1 }, { name: "idx_ciudad" });

// publicaciones
db.publicaciones.createIndex({ likes: -1 }, { name: "idx_likes_desc" });
db.publicaciones.createIndex({ fecha: -1 }, { name: "idx_fecha_desc" });
db.publicaciones.createIndex({ hashtags: 1 }, { name: "idx_hashtags" });
db.publicaciones.createIndex({ autor_id: 1, fecha: -1, likes: 1 }, { name: "idx_autor_fecha_likes" });

// comentarios
db.comentarios.createIndex({ publicacion_id: 1, fecha: -1 }, { name: "idx_publicacion_fecha" });
```

---

## 5. Carga de datos

Con el clúster levantado, el modelo definido y los índices creados, faltaba poblar la base. Este proceso no se hizo de una sola vez ni de la forma en que quedó al final: fue un proceso iterativo, y me parece más honesto documentarlo tal cual pasó que mostrar solo el resultado final.

### 5.1. Primera carga, chica y a mano (`insertar_datos.js`)

Antes de cargar miles de documentos, inserté un dataset chico y manual: 5 usuarios, 10 publicaciones, 15 comentarios y 5 historias, con datos inventados a mano y coherentes entre sí (por ejemplo, los `comentarios_recientes` embebidos en cada publicación apuntan exactamente a los mismos comentarios que después están completos en la colección `comentarios`, con el mismo `_id`).

El objetivo de esta primera carga no era simular la escala real de una red social, sino **validar que el modelo documental estuviera bien planteado** antes de escalarlo: confirmar en Compass que la redundancia (`nombre_autor`), el embedding (`hashtags`, `comentarios_recientes`) y las referencias (`autor_id`, `comentario_id`, `publicacion_id`) se veían y se relacionaban como esperaba.

📄 [`insertar_datos.js`](./insert/insertar_datos.js)

<img width="1084" height="299" alt="despues de poner un par de datos" src="https://github.com/user-attachments/assets/aa82da0a-cab8-4864-9388-294691f93ab0" />


### 5.2. Reiniciar los datos (`DeleteAll.js`)

A medida que fui ajustando el modelo (agregar `autor_id` a los comentarios, después `comentario_id`, después los campos de alcance, etc.), necesitaba poder volver a empezar de cero varias veces sin tener que tocar el sharding ni los índices, que ya estaban configurados. Para eso armé `DeleteAll.js`, que simplemente vacía las 4 colecciones:

```javascript
use red_social_tp3;

db.usuarios.deleteMany({});
db.publicaciones.deleteMany({});
db.comentarios.deleteMany({});
db.historias.deleteMany({});
```

Este script lo uso **cada vez que quiero reiniciar los datos de la base** manteniendo la infraestructura y la configuración intactas — sobre todo cada vez que modifico el script de carga masiva y necesito volver a correrlo desde cero.

📄 [`DeleteAll.js`](./insert/DeleteAll.js)

<img width="751" height="157" alt="borramos todos los datos porque modificamos la carga masiva" src="https://github.com/user-attachments/assets/527f6c06-d841-4f32-a005-88e23a79561b" />


### 5.3. Carga masiva de datos (`insertar_datos_masivos.js`)

El dataset de 5 usuarios servía para validar el modelo, pero no para ver cómo se comporta realmente un clúster fragmentado: con tan pocos documentos, cualquier consulta es instantánea sin importar si hay índices, shard key bien elegida, etc. Para poder observar de verdad **cómo se distribuyen los datos entre los 3 shards** y tener volumen suficiente para el resto del TP (consultas, updates, operaciones matemáticas), le pedí ayuda a la IA para armar un script de carga masiva.

Este script genera miles de usuarios con distinta cantidad de seguidores (la mayoría con pocos, algunos "influencers" con muchísimos), a cada uno le genera entre 0 y 50 publicaciones, y calcula los likes y comentarios de cada publicación en función de los seguidores del autor —a más seguidores, más interacción—, además de simular un pequeño porcentaje de publicaciones "virales" con picos de likes y comentarios independientes del autor. A partir de esta carga es que se resuelve el resto de las consultas y ejercicios del TP.

📄 [`insertar_datos_masivos.js`](./insert/insertar_datos_masivos.js)

<img width="1417" height="497" alt="DB_carga_masiva" src="https://github.com/user-attachments/assets/cc3585d1-869f-4a53-a557-528ebb314208" />


### 5.4. Agregar campos que me faltaban (`agregar_alcance_y_flags.js`)

Ya con la base cargada y avanzando en las consultas del TP, llegué a la Parte 5 (operaciones matemáticas) y me encontré con los puntos 23 y 24, que piden reducir el alcance de publicaciones *reportadas* y duplicar el de publicaciones *promocionadas*. Ahí me di cuenta de que el modelo de `publicaciones` no tenía ninguno de esos tres campos (`alcance`, `promocionada`, `reportada`): no los había contemplado en el diseño original porque no aparecían en el enunciado de la Parte 1 ni en los datos de prueba iniciales.

En vez de modificar el script de carga masiva y tener que volver a insertar todo desde cero, con ayuda de la IA armé un script aparte que recorre las publicaciones ya existentes y les agrega esos tres campos con `bulkWrite`, calculando el alcance en función de los likes que ya tenía cada publicación.

📄 [`agregar_alcance_y_flags.js`](./insert/agregar_alcance_y_flags.js)

<img width="833" height="191" alt="agregamos las promociones y reportes" src="https://github.com/user-attachments/assets/e87cad92-533d-4b5a-958a-0e084e2576d8" />


---

## 6. Consultas (Parte 3 del TP)

Todas las consultas de esta parte se resuelven con el método **`find()`**, que es el método base de MongoDB para buscar documentos que cumplan un criterio (a diferencia de `aggregate()`, pensado para pipelines de varias etapas —agrupar, transformar, unir colecciones, etc.—). Como en esta parte del TP cada punto es un filtro, un orden o una proyección simple sobre una sola colección, `find()` alcanza y sobra: usar `aggregate()` acá sería una complejidad innecesaria.

`find()` recibe hasta dos argumentos: un **filtro** (qué documentos traer) y, opcionalmente, una **proyección** (qué campos de esos documentos mostrar). Sobre el cursor que devuelve, se le pueden encadenar `sort()`, `limit()` y `skip()` para ordenar y paginar.

---

### 1) Buscar todos los usuarios mayores de 18 años.

📄 [código](./Consultas/Busqueda_1.js)

```javascript
db.usuarios.find({ edad: { $gte: 18 } });
```

Uso el operador **`$gte`** (*greater than or equal*) porque "mayores de 18" en general se interpreta como 18 inclusive. Esta consulta se beneficia directamente del índice `idx_edad` que creé sobre `usuarios`, así que en vez de recorrer toda la colección, Mongo puede ir directo al rango de edades que cumple la condición dentro del árbol B de cada shard.

---

### 2) Buscar publicaciones que tengan más de 100 likes.

📄 [código](./Consultas/Busqueda_2.js)

```javascript
db.publicaciones.find({ likes: { $gt: 100 } });
```

Acá uso **`$gt`** (*greater than*, estricto, sin incluir el 100) porque el enunciado dice "más de 100", no "100 o más". Esta consulta aprovecha el índice `idx_likes_desc`: aunque el índice esté armado en orden descendente, a Mongo no le importa la dirección para resolver un filtro por rango, igual puede recorrerlo en cualquier sentido.

---

### 3) Buscar publicaciones cuyo autor sea "Juan".

📄 [código](./Consultas/Busqueda_3.js)

```javascript
db.publicaciones.find({ nombre_autor: "Juan" });
```

Filtro por igualdad simple sobre `nombre_autor`, el campo redundante que guardo en cada publicación (ver Parte 3 del README, sección de diseño) justamente para no tener que ir a buscar el nombre a la colección `usuarios`. Vale aclarar que esta consulta **no** usa la shard key de `publicaciones` (que es `autor_id`, no `nombre_autor`) ni ningún índice secundario que haya creado, así que Mongo la resuelve como *scatter-gather*: le pregunta a los 3 shards por igual. Como decidí no indexar `nombre_autor` (no es un patrón de búsqueda de alta frecuencia en el diseño real de la red social, según lo que expliqué en la sección de índices), esta consulta puntual queda un poco menos optimizada a propósito.

---

### 4) Buscar usuarios que tengan entre 500 y 2000 seguidores.

📄 [código](./Consultas/Busqueda_4.js)

```javascript
db.usuarios.find({ seguidores: { $gte: 500, $lte: 2000 } });
```

Un rango cerrado se arma combinando **`$gte`** y **`$lte`** en el mismo campo (ambos extremos inclusive, según cómo está redactado el enunciado). Esta consulta usa el índice `idx_seguidores`, recorriendo el árbol B solo en el tramo de valores entre 500 y 2000, sin tener que revisar usuarios fuera de ese rango.

---

### 5) Buscar publicaciones que contengan el hashtag "mongodb".

📄 [código](./Consultas/Busqueda_5.js)

```javascript
db.publicaciones.find({ hashtags: "mongodb" });
```

Cuando el campo filtrado es un array (`hashtags`), Mongo interpreta automáticamente que hay que traer los documentos donde ese array **contiene** el valor indicado, sin necesitar ningún operador especial. Esta consulta usa `idx_hashtags`, que es un índice *multikey* (cada hashtag del array tiene su propia entrada en el árbol), lo que permite encontrar las publicaciones directamente sin recorrer el array de cada documento uno por uno.

---

### 6) Buscar publicaciones que tengan menos de 50 comentarios o más de 500 likes.

📄 [código](./Consultas/Busqueda_6.js)

```javascript
db.publicaciones.find({
  $or: [
    { likes: { $gt: 500 } },
    { comentarios_totales: { $lt: 50 } }
  ]
});
```

Como la condición es "o una cosa o la otra" (no las dos a la vez), uso **`$or`**, que recibe un array de condiciones y trae los documentos que cumplen *al menos una*. Acá vale una aclaración honesta sobre performance: la rama de `likes` sí puede aprovechar `idx_likes_desc`, pero `comentarios_totales` no tiene índice propio (fue una decisión consciente, explicada en la sección de índices: no lo considero una consulta de alta frecuencia en el uso real de la red social). Frente a un `$or` con una rama sin índice, Mongo termina teniendo que revisar más documentos de los que revisaría si ambos campos estuvieran indexados — es el tipo de trade-off que mencioné antes: no indexo todo lo que se *podría* consultar, solo lo que se consulta seguido.

---

### 7) Buscar usuarios que vivan en "Buenos Aires".

📄 [código](./Consultas/Busqueda_7.js)

```javascript
db.usuarios.find({ ciudad: "Buenos Aires" });
```

Igualdad simple sobre `ciudad`, resuelta con el índice `idx_ciudad`. Como la cantidad de ciudades posibles es chica en comparación con la cantidad de usuarios, este campo tiene buena selectividad para indexar (achica bastante el conjunto de resultados).

---

### 8) De todos los usuarios traer solamente Nombre, Seguidores y Ciudad, sin `_id`.

📄 [código](./Consultas/Busqueda_8.js)

```javascript
db.usuarios.find({}, { nombre: 1, seguidores: 1, ciudad: 1, _id: 0 });
```

Acá el primer argumento de `find()` queda vacío (`{}`, sin filtro: trae todos los usuarios) y lo que hace el trabajo es el segundo argumento, la **proyección**. Con `1` marco los campos que sí quiero mostrar, y con `_id: 0` saco explícitamente el `_id`, que Mongo devuelve por defecto en toda consulta si no se lo excluye a propósito. Como no hay filtro, esta consulta no usa ningún índice para *buscar* — de hecho recorre la colección entera —, la proyección solo decide qué se muestra de cada documento, no cuáles se traen.

---

### 9) Mostrar las 5 publicaciones con más likes.

📄 [código](./Consultas/Busqueda_9.js)

```javascript
db.publicaciones.find().sort({ likes: -1 }).limit(5);
```

Encadeno **`sort({likes: -1})`** (orden descendente) y **`limit(5)`**. Esta es exactamente la consulta para la que armé `idx_likes_desc`: como el índice ya mantiene los documentos ordenados por likes en el árbol B, Mongo no necesita traer toda la colección y ordenarla en memoria — simplemente recorre el índice desde el valor más alto y corta a los primeros 5 resultados.

---

### 10) Mostrar publicaciones ordenadas por fecha descendente.

📄 [código](./Consultas/Busqueda_10.js)

```javascript
db.publicaciones.find().sort({ fecha: -1 });
```

Mismo principio que el punto anterior pero sin `limit()`: se ordena todo el resultado por `fecha` descendente, aprovechando `idx_fecha_desc` para no tener que hacer un sort en memoria sobre toda la colección.

---

### 11) Mostrar publicaciones paginadas: omitir las primeras 5, traer solamente 5.

📄 [código](./Consultas/Busqueda_11.js)

```javascript
db.publicaciones.find().skip(5).limit(5);
```

**`skip(5)`** descarta los primeros 5 documentos del resultado y **`limit(5)`** corta en 5 los que siguen. Es la forma más directa de resolver una paginación simple, aunque vale aclarar una limitación conocida: `skip()` no "salta" mágicamente esos documentos, internamente los recorre igual y los descarta, así que en una colección con millones de documentos y páginas muy alejadas del principio (por ejemplo `skip(500000)`), esta operación se vuelve progresivamente más lenta. Para esta parte del TP, con un `skip` chico, no es un problema; en un sistema real de paginación de feed a gran escala, se suele preferir paginar por un cursor (por ejemplo, "traer publicaciones con fecha menor a la última que vi") en lugar de `skip`/`limit`.

---

## 7. Updates (Parte 4 del TP)

Antes de entrar en cada punto, me gustaria decir que la dificultad fue en escalada de una forma que en su momento me causó un poco de gracia. Los primeros puntos (`$set`, `$inc` simple) no fueron dificiles. Después el 15 y el 16 (agregar/quitar un hashtag) seguían siendo faciles. Pero el 17 y  18 (agregar y eliminar un comentario específico) me costaron bastante más de lo esperado, porque ahí ya no alcanza con un operador suelto: hay que mantener sincronizados dos lugares distintos (la colección `comentarios` y el array embebido dentro de la publicación) a mano, sin ningún mecanismo automático de Mongo que lo haga por mí. Y  después de esos dos, el punto 19 (modificar la ciudad de un usuario) fue, otra vez, trivial — un solo `$set`. Yo me esperaba un ejercicio super complicado, la diferencia de dificultad me resulto muy graciosa. 

---

### 12) Modificar la biografía de un usuario.

📄 [código](./Updates/Updates_1.js)

```javascript
db.usuarios.updateOne(
  { _id: ObjectId('6abd63f129d70067564c3dd6') },
  { $set: { biografia: "Desarrollador de software" } }
);
```

Uso **`$set`**, el operador más básico de update: reemplaza el valor de un campo por el que le paso, sin tocar el resto del documento. Como el filtro es por `_id` (la shard key de `usuarios`), esta operación es *targeted*: va directo a un solo shard.

<img width="665" height="805" alt="update_1" src="https://github.com/user-attachments/assets/7ed9408a-f440-44d8-a0d5-21ce269a2f3b" />


---

### 13) Incrementar en 100 los likes de una publicación.

📄 [código](./Updates/Updates_2.js)

```javascript
db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f329d70067564c78d0') },
  { $inc: { likes: 100 } }
);
```

Acá uso **`$inc`** en vez de leer el valor actual, sumarle 100 y hacer un `$set` con el resultado. La ventaja de `$inc` es que la suma la hace el propio motor de Mongo de forma atómica: si dos personas le dan "me gusta" a la publicación al mismo tiempo, ninguno de los dos incrementos se pierde, algo que sí podría pasar si hiciera primero un `find` y después un `$set` con el cálculo hecho en el cliente.

<img width="738" height="596" alt="update_2" src="https://github.com/user-attachments/assets/e47e721b-a53b-4919-92c2-d0e0906cf505" />


---

### 14) Reducir en 20 los seguidores de un usuario.

📄 [código](./Updates/Updates_3.js)

```javascript
db.usuarios.updateOne(
  { _id: ObjectId('6abd63f129d70067564c3d77') },
  { $inc: { seguidores: -20 } }
);
```

Mismo operador que el punto anterior, pero con un valor negativo: `$inc` no distingue entre sumar y restar, simplemente suma el número que le paso, así que restar es sumar un negativo.

<img width="661" height="811" alt="update_3" src="https://github.com/user-attachments/assets/2f773ac5-876d-4a0e-afb4-25498e541aaa" />


---

### 15) Agregar un hashtag nuevo a una publicación.

📄 [código](./Updates/Updates_4.js)

```javascript
db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f329d70067564c78cc') },
  { $push: { hashtags: "POO" } }
);
```

**`$push`** agrega un elemento al final de un array. Es el operador natural acá porque `hashtags` ya está diseñado como array desde el modelado inicial (Embedding).

<img width="811" height="686" alt="update_4" src="https://github.com/user-attachments/assets/385b85f7-f824-4ec1-a664-74e074afe2a3" />


---

### 16) Eliminar un hashtag.

📄 [código](./Updates/Updates_5.js)

```javascript
db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f329d70067564c78cc') },
  { $pull: { hashtags: "POO" } }
);
```

**`$pull`** es el complemento de `$push`: saca de un array todos los elementos que coincidan con el valor indicado (en este caso, "POO"), sin tener que saber en qué posición del array estaba.

<img width="775" height="658" alt="update_5" src="https://github.com/user-attachments/assets/d3993170-ae0e-42a5-99f9-f51fc0089905" />


---

### 17) Agregar un nuevo comentario a una publicación.

📄 [código](./Updates/Updates_6.js)

```javascript
let nuevoComentarioId = new ObjectId();

db.comentarios.insertOne({
  _id: nuevoComentarioId,
  publicacion_id: ObjectId('6abd63f329d70067564c8181'),
  autor_id: ObjectId('6abd63f129d70067564c3ddf'),
  autor: "Lihuen",
  texto: "Esta re bueno",
  fecha: new Date()
});

db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f329d70067564c8181') },
  {
    $push: {
      comentarios_recientes: {
        $each: [{
          comentario_id: nuevoComentarioId,
          autor_id: ObjectId('6abd63f129d70067564c3ddf'),
          autor: "Lihuen",
          texto: "Esta re bueno"
        }],
        $position: 0,
        $slice: 3
      }
    },
    $inc: { comentarios_totales: 1 }
  }
);
```

Este es el primer punto donde un solo operador no alcanza. Un comentario nuevo tiene que existir en **dos lugares**: como documento completo en la colección `comentarios` (Referencing, el historial real) y, si corresponde, dentro del array `comentarios_recientes` de la publicación (Embedding, para que se vea al instante en el feed sin ir a buscarlo aparte). Por eso el script primero genera el `_id` del comentario a mano (`nuevoComentarioId`) y lo inserta en `comentarios`, y recién después actualiza la publicación reutilizando ese mismo id — la misma lógica de consistencia que usé en la carga masiva de datos.

Para el `$push` sobre `comentarios_recientes` no alcanzaba la forma simple del punto 15, porque acá se necesitan tres cosas a la vez:
- **`$each`**: `$push` por sí solo agrega un único elemento; para poder combinarlo con `$position` y `$slice` hace falta envolverlo en `$each` (aunque en este caso sea un array de un solo elemento).
- **`$position: 0`**: el comentario nuevo tiene que quedar primero (el más reciente arriba), no al final del array como haría un `$push` común.
- **`$slice: 3`**: después de insertar, el array se recorta a los primeros 3 elementos. Así garantizo que `comentarios_recientes` nunca crezca más allá de lo que decidí en el diseño (los últimos 3), sin tener que calcular manualmente qué elemento sobra y sacarlo aparte.

Y, como siempre que se agrega un comentario, `$inc` en la misma operación mantiene actualizado el contador `comentarios_totales`.

<img width="812" height="590" alt="update_6 1" src="https://github.com/user-attachments/assets/94e34bfd-dc1a-412d-821e-74c1da3bf035" />

<img width="783" height="919" alt="update_6 2" src="https://github.com/user-attachments/assets/157be9ac-fd42-4072-b007-7e8d66faf062" />

<img width="877" height="599" alt="update_6 3" src="https://github.com/user-attachments/assets/82af7fef-da6c-4f15-a86d-0bb7ae77ce59" />


---

### 18) Eliminar un comentario específico.

📄 [código](./Updates/Updates_7.js)

```javascript
db.comentarios.deleteOne({ _id: ObjectId('6abd63f229d70067564c4a40') });

let ultimos3 = db.comentarios.aggregate([
  { $match: { publicacion_id: ObjectId('6abd63f229d70067564c451f') } },
  { $sort: { fecha: -1 } },
  { $limit: 3 },
  { $project: { _id: 0, comentario_id: "$_id", autor_id: 1, autor: 1, texto: 1 } }
]).toArray();

db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f229d70067564c451f') },
  {
    $set: { comentarios_recientes: ultimos3 },
    $inc: { comentarios_totales: -1 }
  }
);
```

Este fue, sin dudas, el punto que más me costo 4 y eso que el anterior me costo bastante. Borrar el comentario en sí es lo fácil: un `deleteOne` filtrando por `_id`. El problema real aparece después: **¿qué pasa con el array `comentarios_recientes` de la publicación?**

Si el comentario borrado era uno de los que estaban embebidos, no alcanza con sacarlo del array con un `$pull` (que sería la solución obvia): al hacer eso, el array quedaría con solo 2 elementos, cuando en realidad debería completarse con el comentario que ahora "entra" al top 3. Por eso, en vez de tocar el array a mano, la solución que encontré fue **recalcularlo desde cero** con una consulta a la fuente de la verdad (la colección `comentarios`):

1. `$match` filtra los comentarios de esa publicación puntual (usa la shard key `publicacion_id`, así que es *targeted*).
2. `$sort` por `fecha` descendente para tener los más nuevos primero.
3. `$limit: 3` se queda solo con los 3 más recientes.
4. `$project` les da la forma exacta que necesita el array embebido, renombrando `_id` a `comentario_id` para que coincida con el esquema que uso en el resto del proyecto.

El resultado de ese `aggregate` se usa directamente en un `$set` sobre `comentarios_recientes` (reemplaza todo el array, no lo modifica parcialmente), junto con el `$inc: -1` del contador. Esto me hizo tomar más conciencia de un tema que ya había explicado en la Parte 3 del README (diseño del modelo): cuando se decide duplicar/embeber información por performance, **el costo se paga en el momento del update**, no en el de la lectura — hay que escribir explícitamente la lógica que mantiene esa copia sincronizada, porque MongoDB no lo hace solo.

<img width="729" height="412" alt="update_7 1" src="https://github.com/user-attachments/assets/fc655eac-40d0-4e27-9374-a545f274a9db" />

<img width="998" height="636" alt="update_7 2" src="https://github.com/user-attachments/assets/baf0d5d2-970f-4dea-959f-30eb2941ea76" />

<img width="757" height="564" alt="update_7 3" src="https://github.com/user-attachments/assets/58c947ea-c35d-41d7-882a-cd3c6eb38c38" />

<img width="1051" height="628" alt="update_7 4" src="https://github.com/user-attachments/assets/3e8897ec-50dc-444c-95d0-0ba7afb24bca" />


---

### 19) Modificar la ciudad de un usuario.

📄 [código](./Updates/Updates_8.js)

```javascript
db.usuarios.updateOne(
  { _id: ObjectId('6abd63f129d70067564c3d52') },
  { $set: { ciudad: "Rosario" } }
);
```

De vuelta a un `$set` simple sobre un campo suelto, igual que el punto 12 — después de la complejidad de los dos puntos anteriores, este fue un respiro.

<img width="657" height="781" alt="update_8" src="https://github.com/user-attachments/assets/2027f5cf-786c-4840-b64e-d2342ef40916" />


---

## 8. Operaciones matemáticas (Parte 5 del TP)

El enunciado pedía explícitamente investigar un par de operadores que no había usado hasta ahora (`$mul`, `$sum`, `$expr`), así que antes de escribir cada consulta tuve que entender bien qué hacía cada uno, igualmente tuve que hacer trabajo de investigacion durante todo el tp.
En parte me la complique solo al hostear los servidores, pero me es interesante entender bien como funciona.

---

### 20) Agregar 500 créditos virtuales al saldo de un usuario.

📄 [código](./Operaciones_matematicas/Operacion_1.js)

```javascript
db.usuarios.updateOne(
  { _id: ObjectId('6abd63f129d70067564c3dd3') },
  { $inc: { creditos_virtuales: 500 } }
);
```

Usé **`$inc`**, el mismo operador de la Parte 4, sobre `creditos_virtuales`. No hay nada nuevo acá conceptualmente respecto a incrementar likes o seguidores, es lo mismo aplicado a otro campo numérico.

<img width="575" height="833" alt="operaciones_1" src="https://github.com/user-attachments/assets/cd60a945-72ff-4f3d-b793-7bc26f57c32b" />

---

### 21) Descontar 200 créditos virtuales.

📄 [código](./Operaciones_matematicas/Operacion_2.js)

```javascript
db.usuarios.updateOne(
  { _id: ObjectId('6abd63f129d70067564c3dd6') },
  { $inc: { creditos_virtuales: -200 } }
);
```

Igual que el punto anterior, `$inc` con un valor negativo para restar.

<img width="636" height="805" alt="operaciones_2" src="https://github.com/user-attachments/assets/fc65855d-2c13-4bd1-abe1-af934b1e00b7" />


---

### 22) Aumentar en un 10% la cantidad de likes de publicaciones que tengan menos de 100 likes.

📄 [código](./Operaciones_matematicas/Operacion_3.js)

```javascript
db.publicaciones.updateMany(
  { likes: { $lt: 100 } },
  { $mul: { likes: 1.10 } }
);
```

Acá es donde entra el operador que el TP pedía investigar: **`$mul`**. A diferencia de `$inc`, que suma un valor fijo, `$mul` multiplica el valor actual del campo por el factor que le paso. Para aumentar un 10%, el factor es 1.10 (el 100% que ya tenía, más el 10% de aumento). Usé `updateMany` en vez de `updateOne` porque el punto pide aplicar esto a *todas* las publicaciones que cumplan la condición, no a una puntual.

<img width="308" height="269" alt="operaciones_3" src="https://github.com/user-attachments/assets/e136c117-a4c1-458f-aaac-43d9207bdee1" />


---

### 23) Reducir en un 15% el alcance de publicaciones reportadas.

📄 [código](./Operaciones_matematicas/Operacion_4.js)

```javascript
db.publicaciones.updateMany(
  { reportada: true },
  { $mul: { alcance: 0.85 } }
);
```

Mismo operador `$mul`, pero para reducir en vez de aumentar el factor tiene que ser menor a 1: reducir un 15% es quedarse con el 85% del valor original, entonces multiplico por 0.85. El filtro `{ reportada: true }` usa el campo booleano que agregué con el script `agregar_alcance_y_flags.js`.

<img width="356" height="305" alt="operaciones_4" src="https://github.com/user-attachments/assets/e1903266-8bf9-4fe2-8595-15c76d3c2c97" />


---

### 24) Duplicar el alcance de las publicaciones promocionadas.

📄 [código](./Operaciones_matematicas/Operacion_5.js)

```javascript
db.publicaciones.updateMany(
  { promocionada: true },
  { $mul: { alcance: 2 } }
);
```

Duplicar es simplemente multiplicar por 2, así que reutilizo `$mul` una vez más, ahora sobre `promocionada: true`.

<img width="336" height="266" alt="operaciones_5" src="https://github.com/user-attachments/assets/58a4547c-c904-470c-a382-baf2e3888083" />


---

### 25) Crear un campo `interacciones_totales` con la suma de likes, comentarios y compartidos.

📄 [código](./Operaciones_matematicas/Operacion_6.js)

```javascript
db.publicaciones.updateMany(
  {},
  [
    {
      $set: {
        interacciones_totales: {
          $sum: [
            "$likes",
            "$comentarios_totales",
            { $ifNull: ["$compartidos", 0] }
          ]
        }
      }
    }
  ]
);
```

Este punto tiene dos cosas para destacar. La primera es la forma del `updateMany`: en vez de pasarle un objeto de update clásico (`{ $set: {...} }`), le paso un **array** (`[{ $set: {...} }]`). Esto convierte la operación en un *update con pipeline de agregación*, que es lo que necesito para poder calcular un campo nuevo **a partir de otros campos del mismo documento** (`$likes`, `$comentarios_totales`). Con la sintaxis clásica de update no se puede hacer esto directamente, porque los operadores como `$set` esperan un valor fijo, no una expresión que lea otros campos del documento.

La segunda es el propio **`$sum`**: lo uso para sumar varios valores dentro de un mismo documento.

Por último, agregué `$ifNull: ["$compartidos", 0]` porque el modelo de `publicaciones` nunca definió un campo `compartidos` (no lo contemplé en el diseño original). Si hubiera puesto `"$compartidos"` a secas, ese valor sería `null` para todos los documentos y hubiera roto la suma completa (sumar cualquier cosa con `null` da `null`). Con `$ifNull` le digo "si `compartidos` no existe, usá 0 en su lugar", así la suma se resuelve igual aunque el campo no esté.

<img width="447" height="599" alt="operaciones_6" src="https://github.com/user-attachments/assets/9b5783d5-cebf-4a8c-a3fc-e9b9b0aee37b" />


---

### 26) Actualizar una publicación sumando 25 likes y aumentando un 5% las visualizaciones, todo en una sola operación.

📄 [código](./Operaciones_matematicas/Operacion_7.js)

```javascript
db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f329d70067564c788c') },
  {
    $inc: { likes: 25 },
    $mul: { visualizaciones: 1.05 }
  }
);
```

El punto pide explícitamente que las dos modificaciones vayan "en una sola operación", así que combiné **`$inc`** y **`$mul`** dentro del mismo documento de update. Mongo aplica los dos operadores sobre el mismo documento de forma atómica en una única escritura, en vez de hacer dos `updateOne` separados.

<img width="439" height="341" alt="operaciones_7" src="https://github.com/user-attachments/assets/be6a3584-7fd4-4da4-a7ac-fef2b4cda942" />


---

### 27) Buscar publicaciones donde la cantidad de likes sea mayor a 3 veces la cantidad de comentarios.

📄 [código](./Operaciones_matematicas/Operacion_8.js)

```javascript
db.publicaciones.find({
  $expr: {
    $gt: [
      "$likes",
      { $multiply: ["$comentarios_totales", 3] }
    ]
  }
});
```

Este último punto necesitaba comparar **dos campos del mismo documento entre sí** (`likes` contra `comentarios_totales × 3`), y ahí es donde la sintaxis normal de `find()` se queda corta: un filtro como `{ likes: { $gt: "$comentarios_totales" } }` no funciona, porque los operadores de consulta clásicos (`$gt`, `$lt`, etc.) esperan un valor literal del lado derecho, no el nombre de otro campo.

Para poder comparar campos entre sí dentro de un `find()`, hace falta **`$expr`**, que habilita usar expresiones de agregación dentro de una consulta normal. Adentro de `$expr` uso `$gt` para la comparación y **`$multiply`** para calcular `comentarios_totales * 3` antes de compararlo contra `likes`.

<img width="694" height="932" alt="operaciones_8" src="https://github.com/user-attachments/assets/b55c90a4-a968-4076-ae78-536cdf44339c" />


---

## 9. Deletes (Parte 6 del TP)

### 28) Eliminar una historia.

📄 [código](./Deletes/Deletes_1.js)

```javascript
db.historias.deleteOne({ _id: ObjectId('6abd643229d700675659bea2') });
```

`deleteOne` con un filtro por `_id` es la forma más directa de borrar un documento puntual: como `_id` es la shard key de `historias`, esta operación es *targeted*, va directo a un solo shard sin necesitar preguntarle a los otros dos.

<img width="733" height="431" alt="dalete_1" src="https://github.com/user-attachments/assets/b04bd8f1-b0e7-44ac-8584-9800974aa2b0" />


---

### 29) Eliminar publicaciones con menos de 5 likes y más de 1 año de antigüedad.

📄 [código](./Deletes/Deletes_2.js)

```javascript
db.publicaciones.deleteMany({
  likes: { $lt: 5 },
  $expr: {
    $lt: [
      "$fecha",
      {
        $dateSubtract: {
          startDate: "$$NOW",
          unit: "year",
          amount: 1
        }
      }
    ]
  }
});
```

Acá combino dos condiciones con un `$and` implícito (poner varios campos en el mismo objeto de filtro ya significa "y"): `likes: { $lt: 5 }` es un filtro clásico y directo. La parte de "más de 1 año de antigüedad" es la que necesitó algo más elaborado.

El problema es que "hace más de 1 año" no es una fecha fija, sino una fecha **relativa al momento en que se ejecuta la consulta**. No puedo escribir un valor de fecha en el filtro, porque mañana esa fecha ya no representaría "hace 1 año". Por eso uso **`$dateSubtract`**, un operador de fecha que le resta una cantidad de tiempo a otra fecha — en este caso, le resto 1 año a `"$$NOW"` (la variable especial de agregación que representa el momento exacto en que se ejecuta la consulta). Elegí `$dateSubtract` con `unit: "year"` en vez de calcular manualmente milisegundos (por ejemplo `365 * 24 * 60 * 60 * 1000`), porque esa cuenta manual no es exacta: no todos los años tienen la misma cantidad de días (años bisiestos), y `$dateSubtract` maneja esa aritmética de calendario correctamente en vez de asumir un año de duración fija.

Y como esta comparación involucra una expresión calculada (`$dateSubtract`) en vez de un valor literal, tengo que envolverla en **`$expr`** — la misma razón por la que la usé en el punto 27: los operadores de consulta clásicos (`$lt`, `$gt`, etc.) esperan un valor fijo del lado derecho, no una expresión que se calcule en el momento.

Una aclaración de performance: la parte `likes: { $lt: 5 }` sí puede aprovechar `idx_likes_desc`, pero la comparación dentro de `$expr` sobre `fecha` no se beneficia de `idx_fecha_desc` de la misma manera en que lo haría un filtro clásico (`{ fecha: { $lt: unaFechaFija } }`) — de esta manera podemos ver que meter una expresión de agregación dentro de un `find()` da flexibilidad, pero no siempre con el mismo aprovechamiento de índices que un filtro simple.

<img width="836" height="953" alt="dalete_2 1" src="https://github.com/user-attachments/assets/8126c305-ca73-47eb-b232-a3bc626e2236" />

<img width="594" height="859" alt="dalete_2 2" src="https://github.com/user-attachments/assets/3a8e3520-d3fb-47d6-a73d-81f922b8e462" />


---

## 10. Análisis conceptual (Parte 7 del TP)

### 1) ¿Qué ventajas tiene MongoDB para una red social?

Después de armar todo este proyecto, la ventaja que más viví en la práctica es que el modelo documental encaja naturalmente con cómo se lee una red social: un post con sus últimos comentarios, sus hashtags y el nombre de su autor es, conceptualmente, "una sola cosa" que se muestra junta, y en MongoDB puedo guardarlo y leerlo como un solo documento en vez de reconstruirlo con varios `JOIN` cada vez. A eso se le suma la escalabilidad horizontal real que armé con el sharding: una red social genera un volumen de escritura (likes, comentarios, historias) que crece todo el tiempo, y poder repartir esa carga entre varios shards en vez de escalar un único servidor verticalmente es una ventaja concreta a largo plazo.

### 2) ¿Qué problemas puede generar abusar del embedding?

Viví este problema de primera mano en la Parte 4: cuando embebí los últimos comentarios dentro de la publicación, cualquier cambio en esos comentarios (agregar uno nuevo, borrar uno específico) dejó de ser una sola escritura simple y pasó a requerir mantener sincronizados dos lugares a mano. Si hubiera abusado del embedding, por ejemplo, guardando todos los comentarios de un post dentro de su propio documento en vez de solo los últimos 3— en vez de  un problema de sincronización tendria un problema de limite, un post viral con miles de comentarios podría haber superado el límite de 16MB por documento. En términos generales, embeber de más genera: documentos que crecen sin control, updates más caros y más propensos a errores de sincronización, y lecturas más pesadas cuando en realidad solo necesito una parte chica de ese documento gigante.

### 3) ¿Qué ventajas tiene BSON frente a JSON?

BSON es la representación binaria que usa MongoDB por debajo de lo que yo escribo como JSON en `mongosh`. Tiene dos ventajas concretas que usé sin pensarlo durante todo el proyecto: primero, al ser binario en vez de texto plano, es más rápido de parsear y más compacto de almacenar que JSON. Segundo, y más relevante para mi modelo, BSON tiene tipos de datos que JSON no tiene: `ObjectId`, `Date` y tipos numéricos distinguidos (entero de 32/64 bits, decimal), entre otros. Si hubiera usado JSON puro, campos como `fecha` (que en mi modelo es un `Date` real, no un string) habrían quedado como texto sin ningún tipo nativo, perdiendo la capacidad de hacer comparaciones y ordenamientos por fecha de forma eficiente como hice en varias consultas (`idx_fecha_desc`, el punto 10, el `$dateSubtract` del punto 29).

### 4) ¿Qué ventajas tiene ObjectId?

La ventaja que más aproveché en un clúster distribuido es que un `ObjectId` se genera de forma única **sin necesitar coordinación con un servidor central**: cada nodo o cliente puede generar el suyo de forma independiente con una probabilidad prácticamente nula de colisión, a diferencia de un autoincremental de SQL, que sí necesitaría un único punto que lleve la cuenta (algo que se vuelve un cuello de botella o directamente inviable con varios shards escribiendo en simultáneo). Además, un `ObjectId` tiene el timestamp de creación codificado en sus primeros bytes, así que puedo saber aproximadamente cuándo se creó un documento sin necesitar un campo de fecha aparte, y ocupa un tamaño fijo y chico (12 bytes), lo que lo hace más liviano de indexar que, por ejemplo, un UUID como string.

### 5) ¿Cuándo conviene embebido y cuándo referenciado?

La regla que terminé usando en la práctica, más que una definición de manual, es: embebo cuando esos datos casi siempre se leen *juntos* con el documento principal, no crecen sin límite, y no necesito consultarlos por separado — por eso embebí `hashtags` y los últimos 3 comentarios en `publicaciones`. Referencio cuando la información puede crecer mucho con el tiempo (el historial completo de comentarios de un post viral), cuando necesito poder consultarla de forma independiente del documento padre (buscar todos los comentarios de un usuario, por ejemplo), o cuando el mismo dato podría necesitar existir vinculado a más de un documento a la vez. En resumen: lo que se lee junto conviene guardarlo junto, salvo que el tamaño o la necesidad de consultarlo aparte digan lo contrario.

### 6) ¿Qué ventajas tiene MongoDB frente a SQL para manejar publicaciones y comentarios?

La ventaja que más sentí durante el desarrollo fue la flexibilidad del esquema: fui agregando campos a medida que los necesitaba, (`alcance`/`promocionada`/`reportada` en las publicaciones) sin tener que escribir ninguna migración tipo `ALTER TABLE` ni bloquear la colección mientras lo hacía — cada documento nuevo simplemente lleva los campos que le corresponden. A eso se suma que el modelo documental de `publicaciones` (con el autor y los últimos comentarios embebidos) refleja directamente cómo se lee un feed en la práctica, evitando el `JOIN` entre usuarios, publicaciones y comentarios que en SQL sería necesario para armar esa misma vista. Y a nivel de escala, repartir la escritura constante de likes y comentarios entre varios shards es algo que MongoDB soporta de forma nativa, mientras que escalar horizontalmente una base SQL tradicional para ese mismo patrón de escritura es bastante más complejo de lograr.

---

## 11. Bonus

### 1) Investigar `$regex` y buscar usuarios cuyo nombre comience con "A".

📄 [código](./BONUS/bonus_1.js)

```javascript
db.usuarios.find({
  nombre: { $regex: "^A" }
});
```

**`$regex`** permite filtrar con una expresión regular en vez de una igualdad exacta. El símbolo `^` es un ancla que significa "inicio del string", así que `"^A"` matchea cualquier nombre que *empiece* con "A", no que la contenga en cualquier posición. Por defecto `$regex` es sensible a mayúsculas y minúsculas (si quisiera ignorarlas, tendría que agregar `$options: "i"`), lo cual no fue un problema acá porque en el dataset todos los nombres están capitalizados de la misma forma.

Vale una aclaración que conecta con la sección de índices: una regex anclada al inicio como esta (`^A...`) es la única forma de regex que **sí puede aprovechar un índice** sobre `nombre` si existiera uno, porque el árbol B tiene los valores ordenados alfabéticamente y Mongo puede saltar directo al rango que empieza con "A". Una regex sin ancla al inicio (por ejemplo, buscar un texto en cualquier parte del nombre) no podría aprovechar ese índice de la misma manera, y terminaría revisando todos los documentos igual.

<img width="599" height="919" alt="bonus_1" src="https://github.com/user-attachments/assets/7f93b665-5e93-4ab0-ab80-afcc783a83a8" />


---

### 2) Investigar `$exists` y buscar publicaciones que tengan ubicación.

📄 [código](./BONUS/bonus_2.js)

```javascript
db.publicaciones.find({
  ubicacion: { $exists: true }
});
```

**`$exists`** no compara un valor, sino que filtra según si un campo **está presente o no** en el documento, sin importar qué valor tenga. En mi caso, el resultado esperado de esta consulta es un conjunto vacío: nunca definí un campo `ubicacion` en el modelo de `publicaciones` (no lo contemplé en el diseño original ni lo agregué después, a diferencia de `alcance`/`promocionada`/`reportada`), así que ningún documento lo tiene. Me pareció un buen ejemplo práctico de una ventaja del modelo sin esquema fijo: puedo consultar por la presencia de un campo aunque ese campo no exista en ningún documento de la colección, sin que la consulta falle.

<img width="520" height="914" alt="bonus_2" src="https://github.com/user-attachments/assets/50d60198-3dfe-40ba-bc39-f472d49da47d" />


---

### 3) Investigar `$size` y buscar publicaciones que tengan exactamente 3 hashtags.

📄 [código](./BONUS/bonus_3.js)

```javascript
db.publicaciones.find({
  hashtags: { $size: 3 }
});
```

**`$size`** filtra por la **longitud exacta** de un array, no por su contenido. Es importante remarcar la palabra "exacta": `$size` solo acepta comparación de igualdad, no admite `$gt`/`$lt` directamente (si quisiera "3 o más hashtags", tendría que resolverlo con `$expr` y `$size` dentro de una expresión de agregación, como hice con `$multiply` en el punto 27). En mi carga masiva de datos, cada publicación se generó con entre 1 y 3 hashtags al azar, así que esta consulta trae específicamente las publicaciones que quedaron con el máximo de esa generación.

<img width="499" height="860" alt="bonus_3" src="https://github.com/user-attachments/assets/aff65e0f-3bb5-49a1-8a3c-ff89c0b65c24" />


---

## 12. Extra: análisis del comportamiento de MongoDB

Esta sección **no forma parte del enunciado del TP**: es un extra que quise agregar para ver, con datos reales de mi clúster, cómo se reparten los documentos entre los shards y cómo responde MongoDB según cómo se haga la consulta.

### 12.1. ¿Cómo se distribuyeron los datos entre los shards?

Después de la carga masiva (sección 5.3) consulté la distribución de la colección más grande, `comentarios`, con `db.comentarios.getShardDistribution()`. Esta es la información importante de esa salida de consola:

```
{
  data: '149.3MiB',
  docs: 1441151,
  chunks: 3,
  'Shard shard1': [ '34.21 % data', '34.21 % docs in cluster', '108B avg obj size on shard' ],
  'Shard shard2': [ '32.78 % data', '32.78 % docs in cluster', '108B avg obj size on shard' ],
  'Shard shard3': [ '33 % data', '33 % docs in cluster', '108B avg obj size on shard' ]
}

Shard shard1 -> data: '51.08MiB', docs: 493153, chunks: 1
Shard shard2 -> data: '48.94MiB', docs: 472417, chunks: 1
Shard shard3 -> data: '49.27MiB', docs: 475581, chunks: 1
```

Y esta es la distribución de **todas las colecciones** de la base, obtenida con `$shardedDataDistribution`:

```javascript
db.aggregate([{ $shardedDataDistribution: {} }])
```

```
[
  {
    ns: 'red_social_tp3.comentarios',
    shards: [
      { shardName: 'shard2', numOrphanedDocs: 0, numOwnedDocuments: 472417, ownedSizeBytes: 51021036, orphanedSizeBytes: 0 },
      { shardName: 'shard3', numOrphanedDocs: 0, numOwnedDocuments: 475581, ownedSizeBytes: 51362748, orphanedSizeBytes: 0 },
      { shardName: 'shard1', numOrphanedDocs: 0, numOwnedDocuments: 493153, ownedSizeBytes: 53260524, orphanedSizeBytes: 0 }
    ]
  },
  {
    ns: 'config.system.sessions',
    shards: [
      { shardName: 'shard1', numOrphanedDocs: 0, numOwnedDocuments: 6, ownedSizeBytes: 594, orphanedSizeBytes: 0 }
    ]
  },
  {
    ns: 'red_social_tp3.usuarios',
    shards: [
      { shardName: 'shard2', numOrphanedDocs: 0, numOwnedDocuments: 623, ownedSizeBytes: 87220, orphanedSizeBytes: 0 },
      { shardName: 'shard3', numOrphanedDocs: 0, numOwnedDocuments: 678, ownedSizeBytes: 94920, orphanedSizeBytes: 0 },
      { shardName: 'shard1', numOrphanedDocs: 0, numOwnedDocuments: 699, ownedSizeBytes: 97860, orphanedSizeBytes: 0 }
    ]
  },
  {
    ns: 'red_social_tp3.publicaciones',
    shards: [
      { shardName: 'shard2', numOrphanedDocs: 0, numOwnedDocuments: 9924, ownedSizeBytes: 3096288, orphanedSizeBytes: 0 },
      { shardName: 'shard3', numOrphanedDocs: 0, numOwnedDocuments: 11197, ownedSizeBytes: 3504661, orphanedSizeBytes: 0 },
      { shardName: 'shard1', numOrphanedDocs: 0, numOwnedDocuments: 11500, ownedSizeBytes: 3622500, orphanedSizeBytes: 0 }
    ]
  },
  {
    ns: 'red_social_tp3.historias',
    shards: [
      { shardName: 'shard2', numOrphanedDocs: 0, numOwnedDocuments: 681, ownedSizeBytes: 111003, orphanedSizeBytes: 0 },
      { shardName: 'shard3', numOrphanedDocs: 0, numOwnedDocuments: 678, ownedSizeBytes: 110514, orphanedSizeBytes: 0 },
      { shardName: 'shard1', numOrphanedDocs: 0, numOwnedDocuments: 667, ownedSizeBytes: 108721, orphanedSizeBytes: 0 }
    ]
  }
]
```

(Para que no ocupe tanto espacio, cada shard está en una sola línea; los valores son exactamente los que devolvió la consola.)

Resumido en una tabla (porcentaje de documentos de cada colección que quedó en cada shard):

| Colección | Total de documentos | shard1 | shard2 | shard3 |
|---|---|---|---|---|
| `comentarios` | 1.441.151 | 34,2 % | 32,8 % | 33,0 % |
| `usuarios` | 2.000 | 35,0 % | 31,1 % | 33,9 % |
| `publicaciones` | 32.621 | 35,3 % | 30,4 % | 34,3 % |
| `historias` | 2.026 | 32,9 % | 33,6 % | 33,5 % |

Algunas observaciones sobre estos números:

- **La distribución es muy pareja.** En ninguna colección un shard se aleja demasiado del 33 % ideal, y `numOrphanedDocs` es 0 en todos los casos (no hay documentos huérfanos). Es justamente el resultado que buscaba al elegir hash en vez de rango (sección 2.5): ningún shard quedó sobrecargado.
- **La diferencia es un poco mayor en `publicaciones`** (de 30,4 % a 35,3 %). Tiene sentido: como la shard key es `autor_id`, **todas las publicaciones de un mismo autor van al mismo shard**, así que si algunos usuarios publican más que otros, el reparto no puede ser tan perfecto como cuando la clave es el `_id` de cada documento (`usuarios`, `historias`), donde cada documento se reparte de forma independiente. Es el costo de agrupar los datos que se consultan juntos.
- **Cada shard tiene un solo chunk** (`chunks: 3` en total para `comentarios`). Con alrededor de 50 MiB por shard, los datos son chicos para el tamaño de chunk por defecto de MongoDB, así que el balanceador no tuvo necesidad de dividirlos ni de moverlos.
- **`comentarios` es, por lejos, la colección dominante**: casi todo el dato del clúster (149,3 MiB) son comentarios, con un tamaño promedio de 108 bytes por documento. Por eso es la que mejor muestra el efecto del sharding.
- **`config.system.sessions`** es una colección interna de MongoDB (sesiones del propio clúster) y no forma parte de mi modelo; por eso aparece en un único shard y con apenas 6 documentos.

<img width="1065" height="878" alt="distribucion-1" src="https://github.com/user-attachments/assets/18aef9ad-f011-44f9-aa84-3ee8af229ac0" />

<img width="1055" height="566" alt="distribucion-2" src="https://github.com/user-attachments/assets/cbeab344-94dc-4f52-8758-23d5556532e2" />

### 12.2. Pruebas de enrutamiento y rendimiento

Para ver en la práctica cómo se comporta el clúster, hice una serie de consultas con `.explain("executionStats")` y armé un pequeño **reporte de enrutamiento** que se imprime por consola. En cada captura se ve a qué `mongos` llegó la consulta (a través de HAProxy), en qué shards buscó el enrutador, cuántos documentos devolvió y cuánto tardó.

**Una aclaración sobre los nombres.** Para poder hacer esta parte tuve que **modificar el `docker-compose.yml`** y ponerle nombres explícitos a los dos enrutadores (`mongos1` y `mongos2`). Sin eso, los contenedores se identificaban con nombres como `90e0aa42a9e0`, que son ilegibles y hacían imposible entender, mirando el reporte, qué enrutador había atendido cada consulta.

#### Prueba 1: búsqueda por shard key (`autor_id`, hasheado)

```javascript
db.publicaciones.find({ autor_id: ObjectId('6abd63f129d70067564c3d6e') }).explain("executionStats");
```

Como `autor_id` es la shard key de `publicaciones`, el enrutador sabe exactamente en qué shard está ese autor y **consulta únicamente a `shard2`**. Devolvió 25 documentos en 3 ms.

<img width="393" height="130" alt="debug_1" src="https://github.com/user-attachments/assets/cf3678ef-7069-44e5-9a98-2d5621cd24b9" />


#### Prueba 2: búsqueda por shard key de otro autor

```javascript
db.publicaciones.find({ autor_id: ObjectId('<autor_id de otro usuario>') }).explain("executionStats");
```

Repetí la misma búsqueda con otro autor. Esta vez el enrutador **fue únicamente a `shard3`** (17 documentos en 4 ms): se ve cómo el hash reparte a los autores en distintos shards, y que en ambos casos la consulta es dirigida a uno solo.

<img width="367" height="145" alt="debug_2" src="https://github.com/user-attachments/assets/da3ce512-3591-478e-80cb-afff475d99b0" />


#### Prueba 3: búsqueda por un campo con índice, pero sin hash

```javascript
db.usuarios.find({ nombre: "Victoria" }).explain("executionStats");
```

`nombre` no es la shard key de `usuarios`, así que el enrutador no tiene forma de saber en qué shard están esos usuarios y **tiene que preguntarle a los tres** (`shard1`, `shard2` y `shard3`). Aun así, como el campo tiene un índice, cada shard responde rápido: devolvió 47 documentos en 12 ms.

<img width="416" height="129" alt="debug_3" src="https://github.com/user-attachments/assets/eb2d16f5-4e86-44d9-94a0-b73106d7298b" />


#### Prueba 4: búsqueda por un campo sin hash y sin índice

```javascript
db.comentarios.find({ autor: "Camila" }).explain("executionStats");
```

Acá el campo no es la shard key ni tiene índice, así que se consultan los tres shards y cada uno tiene que **recorrer todos sus comentarios** para encontrar los que coinciden. Devolvió 19.645 documentos en 214 ms.


esta comparación es un poco tramposa y hay que tomarla con cuidado. La búsqueda de la prueba 3 se hizo sobre `usuarios` (2.000 documentos) y esta sobre `comentarios` (más de 1,4 millones), y además devuelve muchísimos más resultados (19.645 contra 47). Sirve para ver el orden de magnitud, pero no es una comparación "limpia" entre colecciones del mismo tamaño.

<img width="436" height="123" alt="debug_4" src="https://github.com/user-attachments/assets/d91e7a2e-d496-4276-9a76-f5e50f0a2850" />


#### Prueba 5: búsqueda por shard key en `comentarios` (`publicacion_id`, hasheado)

```javascript
db.comentarios.find({ publicacion_id: ObjectId('6abd63f229d70067564c4d96') }).explain("executionStats");
```

Como `publicacion_id` es la shard key de `comentarios`, la consulta se dirige a **un solo shard** (`shard2`): devolvió 450 documentos en 4 ms, contra los 214 ms de la prueba anterior sobre la misma colección. Es la misma colección de más de 1,4 millones de documentos, pero con la clave correcta el enrutador evita tener que revisar los tres shards, y la diferencia de tiempo es enorme. Esto es justamente lo que se buscaba con el diseño de la sección 2.5: que "ver los comentarios de una publicación" sea una consulta dirigida.

<img width="384" height="143" alt="debug_5" src="https://github.com/user-attachments/assets/bb43c3ea-e0d3-4959-a0f1-8ab78cfed2ff" />


*Nota: los tiempos son mediciones únicas, no promedios de varias corridas; sirven para comparar órdenes de magnitud, no para sacar valores exactos.*

#### Resumen de las pruebas

| Prueba | Consulta | Campo | Shards consultados | Documentos | Tiempo |
|---|---|---|---|---|---|
| 1 | `publicaciones` por `autor_id` | shard key (hash) | 1 (`shard2`) | 25 | 3 ms |
| 2 | `publicaciones` por `autor_id` (otro autor) | shard key (hash) | 1 (`shard3`) | 17 | 4 ms |
| 3 | `usuarios` por `nombre` | índice, sin hash | 3 | 47 | 12 ms |
| 4 | `comentarios` por `autor` | sin hash ni índice | 3 | 19.645 | 214 ms |
| 5 | `comentarios` por `publicacion_id` | shard key (hash) | 1 (`shard2`) | 450 | 4 ms |

### 12.3. Prueba de tolerancia a fallos: caída de un `mongos`

Para comprobar que tener dos enrutadores sirve de algo (sección 1.3), **detuve el enrutador 1**:

```powershell
docker stop basededatos-mongos1-1
```

Después repetí la primera consulta (la búsqueda por `autor_id` de la prueba 1). El reporte muestra que **HAProxy mandó la consulta a `mongos2`**, que buscó en el mismo shard (`shard2`) y devolvió los mismos 25 documentos, en 9 ms (contra 3 ms cuando respondía `mongos1`; es una sola medición, así que no le doy mucha importancia a esa diferencia). Es decir, el clúster **siguió funcionando perfectamente** sin intervención manual, solo que ahora atendiendo a través del otro enrutador.

<img width="377" height="138" alt="debug_6" src="https://github.com/user-attachments/assets/5b93ee9a-d15f-4172-bdc3-88f705b06e8f" />


Esto confirma en la práctica lo explicado en la sección 1.4: HAProxy reparte las conexiones entre los `mongos` que estén disponibles, y la caída de uno de ellos no deja al clúster inaccesible.

### 12.4. Lo que quise hacer y no llegué: una simulación visual

Mi idea original para esta parte era armar una **simulación visual** en la que se pudiera ver cómo responde MongoDB ante las consultas mientras se van "tirando" distintos servidores (un `mongos`, un nodo de un shard, un config server), con algo parecido a lo que se ve en **Cisco Packet Tracer**: los equipos dibujados, los paquetes viajando de uno a otro y los nodos caídos marcados en rojo.

Llegué a explorar la posibilidad de usar **GNS3** para armarlo, pero el TP en sí me llevó mucho más tiempo del que esperaba y no llegué a realizarlo. Por eso la demostración de esta sección queda limitada al reporte de consola de las capturas anteriores.
