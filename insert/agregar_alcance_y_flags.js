use red_social_tp3;


const CONFIG = {
  PROBABILIDAD_PROMOCIONADA: 0.03, // 3% de los posts son promocionados (pagos)
  PROBABILIDAD_REPORTADA: 0.02,    // 2% de los posts están reportados
  BATCH_SIZE: 1000
};

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max) { return Math.random() * (max - min) + min; }


print("Agregando alcance / promocionada / reportada a las publicaciones...");

let ops = [];
let totalActualizadas = 0;
let totalPromocionadas = 0;
let totalReportadas = 0;


const cursor = db.publicaciones.find({}, { _id: 1, likes: 1 });

function flush() {
  if (ops.length) {
    db.publicaciones.bulkWrite(ops, { ordered: false });
    ops = [];
  }
}

cursor.forEach((pub) => {

  const alcance = Math.round((pub.likes || 0) * randomFloat(1.5, 4) + randomInt(10, 200));

  const esPromocionada = Math.random() < CONFIG.PROBABILIDAD_PROMOCIONADA;
  const esReportada = Math.random() < CONFIG.PROBABILIDAD_REPORTADA;

  if (esPromocionada) totalPromocionadas++;
  if (esReportada) totalReportadas++;

  ops.push({
    updateOne: {
      filter: { _id: pub._id },
      update: {
        $set: {
          alcance,
          promocionada: esPromocionada,
          reportada: esReportada
        }
      }
    }
  });

  totalActualizadas++;
  if (ops.length >= CONFIG.BATCH_SIZE) flush();

  if (totalActualizadas % 2000 === 0) print(`  ...${totalActualizadas} publicaciones actualizadas`);
});
flush();

print("=====================================================");
print(`✅ Publicaciones actualizadas: ${totalActualizadas}`);
print(`   Promocionadas: ${totalPromocionadas}`);
print(`   Reportadas:    ${totalReportadas}`);
print("=====================================================");
