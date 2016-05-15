# This file is part of the LibreRVAC project
#
# Copyright © 2015-2016
#     Aleks-Daniel Jakimenko-Aleksejev <alex.jakimenko@gmail.com>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

use strict;
use warnings;
use v5.10;
use utf8;
use threads;
use threads::shared;
use Thread::Queue;

use Plack::Builder;
use Plack::Request;
use Plack::Response;
use Plack::App::WebSocket;

use File::Slurper 'read_text';
use JSON::XS;
use IO::Handle;
use IO::Socket::UNIX;
use Encode qw(decode encode);

my $SOCK_PATH = "brain.sock";
my $SEP = "\x1E";

my $socket = IO::Socket::UNIX->new(
  Type => SOCK_STREAM(),
  Peer => $SOCK_PATH,
    );

sub header {
  my ($content_type) = @_;
  [
   'Content-Security-Policy' => "default-src 'none'; script-src 'self'; connect-src *; img-src 'self'; style-src 'self';",
   'Content-Type' => "$content_type; charset=utf-8",
  ]
}

sub fifo_send {
  my ($data) = @_;
  $socket->print(encode_json($data), $SEP);
}

my %motor_bypass = (
  'Left wheel'   => 'wheel left',
  'Right wheel'  => 'wheel right',
  'Main brush'   => 'brush main',
  'Side brushes' => 'brush sides',
  'Left brush'   => 'brush left',
  'Right brush'  => 'brush right',
  'Vacuum'       => 'vacuum',
    );

sub process_input {
  my ($text) = @_;
  my $data = decode_json $text;
  if (exists $data->{control}) {
    if (exists $motor_bypass{$data->{control}}) {
      my $motor = $motor_bypass{$data->{control}};
      my $value = $data->{value};
      fifo_send({ command => 'bypass',
                  data    => { c => 'motor',
                               motor => $motor,
                               throttle => $value,
                  }
                });
    } elsif ($data->{control} eq 'Start (normal)') {
      if ($data->{value} == 1.0) {
        fifo_send({ command => 'clean',
                    type    => 'normal',
                  });
      }
    } elsif ($data->{control} eq 'Start (spot)') {
    } elsif ($data->{control} eq 'Docking') {
    }
  }
}

my $app = sub {
  my $req = Plack::Request->new(shift);

  if ($req->path_info =~ m{^ /home/? | ^$ }x) {
    return [200, header('text/html'), [encode 'UTF-8', read_text 'main.html']];
  }
  if ($req->path_info =~ m{ ^/main.js }x) {
    return [200, header('application/javascript'), [encode 'UTF-8', read_text 'main.js']];
  }
  if ($req->path_info =~ m{ ^/main.css }x) {
    return [200, header('text/css'), [encode 'UTF-8', read_text 'main.css']];
  }

  return [404, header('text/html'), [encode 'UTF-8', 'Page not found!']];
};

my %connections :shared;

threads->create(sub {
  local $/ = $SEP;
  say 'Start reading';
  while (<$socket>) {
    chomp;
    for my $conn (values %connections) {
      $conn->enqueue($_);
    }
  }
  threads->detach(); #End thread.
                });

builder {
  mount "/websocket" => Plack::App::WebSocket->new(
    on_error => sub {
      my $env = shift;
      return [500,
              ['Content-Type' => 'text/plain; charset=utf-8'],
              [encode 'UTF-8', 'Error: ' . $env->{'plack.app.websocket.error'}]];
    },
    on_establish => sub {
      say "Client connected!";
      my $conn = shift; ## Plack::App::WebSocket::Connection object
      my $env = shift;  ## PSGI env
      my $queue :shared = Thread::Queue->new();
      {
        lock(%connections);
        $connections{$conn} = $queue;
      }

      threads->create(sub {
        while (1) {
          $conn->send($queue->dequeue());
          #$queue->dequeue();
        }
        threads->detach(); # End thread
                      });

      $conn->on(
        message => sub {
          my ($conn, $msg) = @_;
          process_input $msg;
        },
        finish => sub {
          {
            lock(%connections);
            delete $connections{$conn};
          }
          undef $conn;
          say "Client disconnected!";
        },
          );
    }
      )->to_app;

  mount "/" => $app;
};
