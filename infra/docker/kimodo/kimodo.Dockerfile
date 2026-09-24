# Kimodo (fork Aero-Ex) pronto para rodar só com Docker.
#
# A base kimodo:1.0 já traz o ambiente Python/torch e o pacote `kimodo`
# instalado em modo editável a partir de /workspace; aqui trocamos o código pelo
# do fork (que tem a flag `--offload` para GPUs de 6 GB) e aplicamos os patches
# do instalador nativo. Modelos e caches ficam no volume montado em /opt/kimodo.
#
# Build:  docker --context default compose -f infra/docker/compose.yml build kimodo-demo
# O commit é fixado no mesmo que a instalação local usava.
FROM kimodo:1.0

# O docker_requirements.txt não inclui bitsandbytes, mas o modelo NF4 (4 bits) usa.
RUN pip install --no-cache-dir bitsandbytes

# Fork Aero-Ex, commit fixado.
RUN git clone --filter=blob:none --no-checkout https://github.com/Aero-Ex/kimodo /tmp/kimodo-fork \
 && cd /tmp/kimodo-fork \
 && git fetch --depth 1 origin 3b45cc6d420136bfa6128e8be5e81e45521f2b7a \
 && git checkout -q FETCH_HEAD \
 && rm -rf /workspace/kimodo \
 && cp -a /tmp/kimodo-fork/kimodo /workspace/kimodo \
 && rm -rf /tmp/kimodo-fork

# Wrapper do LLM2Vec apontando para o volume de modelos (patch do instalador).
COPY kimodo/kimodo-llm2vec-wrapper.py /tmp/wrapper.py
RUN sed -i 's#__MODEL_DIR__#/opt/kimodo/models/KIMODO-Meta3_llm2vec_NF4#' /tmp/wrapper.py \
 && cp /tmp/wrapper.py /workspace/kimodo/model/llm2vec/llm2vec_wrapper.py \
 && rm /tmp/wrapper.py

# Patch do playback: os joints neutros precisam ir para o device do frame.
RUN sed -i 's#self\.skeleton\.neutral_joints\[\[self\.skeleton\.root_idx\]\]#self.skeleton.neutral_joints[[self.skeleton.root_idx]].to(new_posed_joints.device)#' \
      /workspace/kimodo/viz/playback.py \
 && grep -q 'root_idx\]\]\.to(new_posed_joints\.device)' /workspace/kimodo/viz/playback.py

# Client web do Viser (build do npm que o fork precisa e o pip não traz).
COPY kimodo/viser-client-build /workspace/kimodo-viser/src/viser/client/build

