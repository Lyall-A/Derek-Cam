FROM node
RUN apt-get update && apt-get install ffmpeg -y
WORKDIR /app
CMD ["node", "."]