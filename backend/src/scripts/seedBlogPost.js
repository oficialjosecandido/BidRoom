require('dotenv').config();
const mongoose = require('mongoose');
const BlogPost = require('../models/BlogPost');

const content = `O mercado de relógios vintage mudou mais na última década do que nos quarenta anos anteriores. Deixou de ser o domínio fechado de uns quantos coleccionadores e tornou-se um espaço global, digital e surpreendentemente jovem. À medida que 2027 se aproxima, há padrões que deixam de ser ruído e começam a ser direcção. Aqui ficam cinco.

## 1. O "neo-vintage" toma o palco

Durante anos, "vintage" significava peças dos anos 50 e 60. Isso está a mudar. Os relógios das décadas de 1980, 1990 e início dos anos 2000 — o chamado *neo-vintage* — são a categoria com maior energia. São peças que uma nova geração de coleccionadores reconhece da própria juventude, com mecânica robusta e preços que ainda não dispararam ao nível das referências clássicas.

Em 2027, esperamos ver esta categoria a consolidar-se como um segmento próprio, com referências específicas a tornarem-se objecto de procura séria. Quem comprar bem agora, à frente da curva, posiciona-se onde o mercado clássico esteve há vinte anos.

## 2. A condição original vale mais que a perfeição

Houve um tempo em que um relógio polido até brilhar valia mais. Esse tempo acabou. O coleccionador informado de hoje quer a peça **tal como o tempo a deixou** — caixa não polida, com as arestas originais intactas, mostradores com pátina honesta, até os chamados mostradores "tropicais" que envelheceram para tons de chocolate.

Esta obsessão pela originalidade vai intensificar-se em 2027. Um relógio com a caixa nunca tocada e o mostrador original, mesmo com marcas de uso, vai consistentemente superar um exemplar "restaurado" do mesmo modelo. A mensagem é clara: a história é o valor, e apagá-la é apagar dinheiro.

## 3. A proveniência passa de bónus a requisito

Caixa e documentos originais, registos de manutenção, a história de quem foi o dono — o que antes era um extra agradável é agora central na formação do preço. À medida que o mercado amadurece e os valores sobem, a documentação deixa de ser luxo e torna-se a linha que separa um bom negócio de um risco.

Em 2027, espere-se que peças com proveniência completa e verificável abram uma distância de preço ainda maior face a peças idênticas sem papéis. A confiança é a verdadeira moeda — e a documentação é como se prova.

## 4. O regresso das proporções discretas

A era dos relógios enormes — caixas de 44, 45 milímetros — está a recuar. O gosto pende de novo para proporções mais contidas e elegantes: os 36 a 39 milímetros que dominaram a relojoaria clássica. Peças vintage com estas dimensões, antes consideradas "pequenas demais" pelos padrões dos anos 2010, voltam a ser exactamente o que se procura.

Esta correcção de gosto favorece naturalmente o mercado vintage, onde estas proporções sempre foram a norma. Em 2027, a discrição usa-se ao pulso.

## 5. Para além dos nomes óbvios

Rolex e Patek Philippe continuarão a dominar as manchetes. Mas o coleccionador curioso de 2027 olha para os lados — para nomes com história e mérito que ainda não foram totalmente "descobertos" pelo grande mercado. Marcas independentes, fabricantes históricos injustamente esquecidos, referências de nicho com cronometria excepcional.

É aqui que vive a verdadeira oportunidade. À medida que as referências óbvias se tornam inacessíveis, a procura desloca-se para a qualidade menos celebrada — e é nessa deslocação que se encontram as peças que serão os clássicos de amanhã.

---

## O fio que liga tudo

Por trás destas cinco tendências há um único movimento de fundo: o mercado de relógios vintage está a tornar-se **mais informado, mais transparente e mais exigente**. Os coleccionadores sabem mais, comparam melhor, e valorizam a autenticidade acima de tudo.

Para quem compra e vende em Portugal, isto é uma boa notícia. Significa que o valor real — a peça honesta, bem documentada, na sua condição original — é hoje reconhecido como nunca foi. E significa que o leilão, quando feito com transparência e rigor, é o lugar onde esse valor se revela.

2027 pertence a quem souber ler a peça antes de licitar.

---

*A BidRoom é um marketplace de leilões premium feito para Portugal, com foco em relógios, arte e objectos com história. As tendências aqui descritas refletem a análise do mercado atual e projeções para o próximo ano — não constituem aconselhamento de investimento.*`;

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const post = await BlogPost.create({
    title: 'Relógios Vintage em 2027: Cinco Tendências que Vão Definir os Leilões',
    excerpt: 'Uma leitura dos sinais que já estão em movimento — e para onde apontam no próximo ano.',
    content,
    coverImage: '',
    category: 'relogios',
    tags: ['relógios vintage', 'tendências', '2027', 'leilões', 'coleccionismo'],
    author: 'BidRoom',
    status: 'published',
    metaDescription: 'Cinco tendências que vão definir o mercado de relógios vintage em 2027: neo-vintage, condição original, proveniência e mais.',
  });

  console.log('Post created:', { id: post._id.toString(), slug: post.slug });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
