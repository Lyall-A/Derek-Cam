FROM bun
RUN apt-get update && apt-get install ffmpeg -y
WORKDIR /app
CMD ["bun", "."]